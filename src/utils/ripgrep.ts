import type { ChildProcess, ExecFileException } from 'child_process'
import { execFile, spawn } from 'child_process'
import { existsSync } from 'fs'
import { readdir, readFile, realpath, stat } from 'fs/promises'
import picomatch from 'picomatch'
import { join, relative } from 'path'
import memoize from 'lodash-es/memoize.js'
import { homedir } from 'os'
import * as path from 'path'
import { fileURLToPath } from 'url'
import { isInBundledMode } from './bundledMode.js'
import { logForDebugging } from './debug.js'
import { isEnvDefinedFalsy } from './envUtils.js'
import { execFileNoThrow } from './execFileNoThrow.js'
import { findExecutable } from './findExecutable.js'
import { logError } from './log.js'
import { getPlatform } from './platform.js'
import { countCharInString } from './stringUtils.js'

const __filename = fileURLToPath(import.meta.url)
// we use node:path.join instead of node:url.resolve because the former doesn't encode spaces
const __dirname = path.join(
  __filename,
  process.env.NODE_ENV === 'test' ? '../../../' : '../',
)

type RipgrepConfig = {
  mode: 'system' | 'builtin' | 'embedded'
  command: string
  args: string[]
  argv0?: string
}

type ResolveRipgrepConfigArgs = {
  userWantsSystemRipgrep: boolean
  bundledMode: boolean
  builtinCommand: string
  builtinExists: boolean
  systemExecutablePath: string
  processExecPath?: string
}

export function resolveRipgrepConfig({
  userWantsSystemRipgrep,
  bundledMode,
  builtinCommand,
  builtinExists,
  systemExecutablePath,
  processExecPath = process.execPath,
}: ResolveRipgrepConfigArgs): RipgrepConfig {
  if (userWantsSystemRipgrep && systemExecutablePath !== 'rg') {
    // SECURITY: Use command name 'rg' instead of systemExecutablePath to prevent PATH hijacking
    return { mode: 'system', command: 'rg', args: [] }
  }

  if (bundledMode) {
    return {
      mode: 'embedded',
      command: processExecPath,
      args: ['--no-config'],
      argv0: 'rg',
    }
  }

  if (builtinExists) {
    return { mode: 'builtin', command: builtinCommand, args: [] }
  }

  if (systemExecutablePath !== 'rg') {
    return { mode: 'system', command: 'rg', args: [] }
  }

  return { mode: 'builtin', command: builtinCommand, args: [] }
}

const getRipgrepConfig = memoize((): RipgrepConfig => {
  const userWantsSystemRipgrep = isEnvDefinedFalsy(
    process.env.USE_BUILTIN_RIPGREP,
  )
  const bundledMode = isInBundledMode()
  const rgRoot = path.resolve(__dirname, 'vendor', 'ripgrep')
  const builtinCommand =
    process.platform === 'win32'
      ? path.resolve(rgRoot, `${process.arch}-win32`, 'rg.exe')
      : path.resolve(rgRoot, `${process.arch}-${process.platform}`, 'rg')
  const builtinExists = existsSync(builtinCommand)
  const { cmd: systemExecutablePath } = findExecutable('rg', [])

  return resolveRipgrepConfig({
    userWantsSystemRipgrep,
    bundledMode,
    builtinCommand,
    builtinExists,
    systemExecutablePath,
  })
})

export function ripgrepCommand(): {
  rgPath: string
  rgArgs: string[]
  argv0?: string
} {
  const config = getRipgrepConfig()
  return {
    rgPath: config.command,
    rgArgs: config.args,
    argv0: config.argv0,
  }
}

const MAX_BUFFER_SIZE = 20_000_000 // 20MB; large monorepos can have 200k+ files

/**
 * Check if an error is EAGAIN (resource temporarily unavailable).
 * This happens in resource-constrained environments (Docker, CI) when
 * ripgrep tries to spawn too many threads.
 */
function isEagainError(stderr: string): boolean {
  return (
    stderr.includes('os error 11') ||
    stderr.includes('Resource temporarily unavailable')
  )
}

/**
 * Custom error class for ripgrep timeouts.
 * This allows callers to distinguish between "no matches" and "timed out".
 */
export class RipgrepTimeoutError extends Error {
  constructor(
    message: string,
    public readonly partialResults: string[],
  ) {
    super(message)
    this.name = 'RipgrepTimeoutError'
  }
}

function ripGrepRaw(
  args: string[],
  target: string,
  abortSignal: AbortSignal,
  callback: (
    error: ExecFileException | null,
    stdout: string,
    stderr: string,
  ) => void,
  singleThread = false,
): ChildProcess {
  // NB: When running interactively, ripgrep does not require a path as its last
  // argument, but when run non-interactively, it will hang unless a path or file
  // pattern is provided

  const { rgPath, rgArgs, argv0 } = ripgrepCommand()

  // Use single-threaded mode only if explicitly requested for this call's retry
  const threadArgs = singleThread ? ['-j', '1'] : []
  const fullArgs = [...rgArgs, ...threadArgs, ...args, target]
  // Allow timeout to be configured via env var (in seconds), otherwise use platform defaults
  // WSL has severe performance penalty for file reads (3-5x slower on WSL2)
  const defaultTimeout = getPlatform() === 'wsl' ? 60_000 : 20_000
  const parsedSeconds =
    parseInt(process.env.CLAUDE_CODE_GLOB_TIMEOUT_SECONDS || '', 10) || 0
  const timeout = parsedSeconds > 0 ? parsedSeconds * 1000 : defaultTimeout

  // For embedded ripgrep, use spawn with argv0 (execFile doesn't support argv0 properly)
  if (argv0) {
    const child = spawn(rgPath, fullArgs, {
      argv0,
      signal: abortSignal,
      // Prevent visible console window on Windows (no-op on other platforms)
      windowsHide: true,
    })

    let stdout = ''
    let stderr = ''
    let stdoutTruncated = false
    let stderrTruncated = false

    child.stdout?.on('data', (data: Buffer) => {
      if (!stdoutTruncated) {
        stdout += data.toString()
        if (stdout.length > MAX_BUFFER_SIZE) {
          stdout = stdout.slice(0, MAX_BUFFER_SIZE)
          stdoutTruncated = true
        }
      }
    })

    child.stderr?.on('data', (data: Buffer) => {
      if (!stderrTruncated) {
        stderr += data.toString()
        if (stderr.length > MAX_BUFFER_SIZE) {
          stderr = stderr.slice(0, MAX_BUFFER_SIZE)
          stderrTruncated = true
        }
      }
    })

    // Set up timeout with SIGKILL escalation.
    // SIGTERM alone may not kill ripgrep if it's blocked in uninterruptible I/O
    // (e.g., deep filesystem traversal). If SIGTERM doesn't work within 5 seconds,
    // escalate to SIGKILL which cannot be caught or ignored.
    // On Windows, child.kill('SIGTERM') throws; use default signal.
    let killTimeoutId: ReturnType<typeof setTimeout> | undefined
    const timeoutId = setTimeout(() => {
      if (process.platform === 'win32') {
        child.kill()
      } else {
        child.kill('SIGTERM')
        killTimeoutId = setTimeout(c => c.kill('SIGKILL'), 5_000, child)
      }
    }, timeout)

    // On Windows, both 'close' and 'error' can fire for the same process
    // (e.g. when AbortSignal kills the child). Guard against double-callback.
    let settled = false
    child.on('close', (code, signal) => {
      if (settled) return
      settled = true
      clearTimeout(timeoutId)
      clearTimeout(killTimeoutId)
      if (code === 0 || code === 1) {
        // 0 = matches found, 1 = no matches (both are success)
        callback(null, stdout, stderr)
      } else {
        const error: ExecFileException = new Error(
          `ripgrep exited with code ${code}`,
        )
        error.code = code ?? undefined
        error.signal = signal ?? undefined
        callback(error, stdout, stderr)
      }
    })

    child.on('error', (err: NodeJS.ErrnoException) => {
      if (settled) return
      settled = true
      clearTimeout(timeoutId)
      clearTimeout(killTimeoutId)
      const error: ExecFileException = err
      callback(error, stdout, stderr)
    })

    return child
  }

  // For non-embedded ripgrep, use execFile
  // Use SIGKILL as killSignal because SIGTERM may not terminate ripgrep
  // when it's blocked in uninterruptible filesystem I/O.
  // On Windows, SIGKILL throws; use default (undefined) which sends SIGTERM.
  return execFile(
    rgPath,
    fullArgs,
    {
      maxBuffer: MAX_BUFFER_SIZE,
      signal: abortSignal,
      timeout,
      killSignal: process.platform === 'win32' ? undefined : 'SIGKILL',
    },
    callback,
  )
}

/**
 * Stream-count lines from `rg --files` without buffering stdout.
 *
 * On large repos (e.g. 247k files, 16MB of paths), calling `ripGrep()` just
 * to read `.length` materializes the full stdout string plus a 247k-element
 * array. This counts newline bytes per chunk instead; peak memory is one
 * stream chunk (~64KB).
 *
 * Intentionally minimal: the only caller is telemetry (countFilesRoundedRg),
 * which swallows all errors. No EAGAIN retry, no stderr capture, no internal
 * timeout (callers pass AbortSignal.timeout; spawn's signal option kills rg).
 */
async function ripGrepFileCount(
  args: string[],
  target: string,
  abortSignal: AbortSignal,
): Promise<number> {
  await codesignRipgrepIfNecessary()
  const { rgPath, rgArgs, argv0 } = ripgrepCommand()

  return new Promise<number>((resolve, reject) => {
    const child = spawn(rgPath, [...rgArgs, ...args, target], {
      argv0,
      signal: abortSignal,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'ignore'],
    })

    let lines = 0
    child.stdout?.on('data', (chunk: Buffer) => {
      lines += countCharInString(chunk, '\n')
    })

    // On Windows, both 'close' and 'error' can fire for the same process.
    let settled = false
    child.on('close', code => {
      if (settled) return
      settled = true
      if (code === 0 || code === 1) resolve(lines)
      else {
        // rg failed (e.g. a broken WASI shim) — fall back to native counting
        // so telemetry still gets a real number.
        logForDebugging(
          `rg --files exited ${code}, falling back to native file count`,
        )
        ripGrepFallback(args, target, abortSignal)
          .then(files => resolve(files.length))
          .catch(reject)
      }
    })
    child.on('error', err => {
      if (settled) return
      settled = true
      // rg could not be started at all (e.g. no binary on PATH). Fall back
      // to native counting instead of failing telemetry.
      logForDebugging(
        `rg --files could not be started (${err.message}), falling back to native file count`,
      )
      ripGrepFallback(args, target, abortSignal)
        .then(files => resolve(files.length))
        .catch(reject)
    })
  })
}

/**
 * Stream lines from ripgrep as they arrive, calling `onLines` per stdout chunk.
 *
 * Unlike `ripGrep()` which buffers the entire stdout, this flushes complete
 * lines as soon as each chunk arrives — first results paint while rg is still
 * walking the tree (the fzf `change:reload` pattern). Partial trailing lines
 * are carried across chunk boundaries.
 *
 * Callers that want to stop early (e.g. after N matches) should abort the
 * signal — spawn's signal option kills rg. No EAGAIN retry, no internal
 * timeout, stderr is ignored; interactive callers own recovery.
 */
export async function ripGrepStream(
  args: string[],
  target: string,
  abortSignal: AbortSignal,
  onLines: (lines: string[]) => void,
): Promise<void> {
  await codesignRipgrepIfNecessary()
  const { rgPath, rgArgs, argv0 } = ripgrepCommand()

  return new Promise<void>((resolve, reject) => {
    const child = spawn(rgPath, [...rgArgs, ...args, target], {
      argv0,
      signal: abortSignal,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'ignore'],
    })

    const stripCR = (l: string) => (l.endsWith('\r') ? l.slice(0, -1) : l)
    let remainder = ''
    child.stdout?.on('data', (chunk: Buffer) => {
      const data = remainder + chunk.toString()
      const lines = data.split('\n')
      remainder = lines.pop() ?? ''
      if (lines.length) onLines(lines.map(stripCR))
    })

    // On Windows, both 'close' and 'error' can fire for the same process.
    let settled = false
    child.on('close', code => {
      if (settled) return
      // Abort races close — don't flush a torn tail from a killed process.
      // Promise still settles: spawn's signal option fires 'error' with
      // AbortError → reject below.
      if (abortSignal.aborted) return
      settled = true
      if (code === 0 || code === 1) {
        if (remainder) onLines([stripCR(remainder)])
        resolve()
      } else {
        reject(new Error(`ripgrep exited with code ${code}`))
      }
    })
    child.on('error', err => {
      if (settled) return
      settled = true
      reject(err)
    })
  })
}

export async function ripGrep(
  args: string[],
  target: string,
  abortSignal: AbortSignal,
): Promise<string[]> {
  await codesignRipgrepIfNecessary()

  // Test ripgrep on first use and cache the result (fire and forget)
  void testRipgrepOnFirstUse().catch(error => {
    logError(error)
  })

  return new Promise((resolve, reject) => {
    const handleResult = (
      error: ExecFileException | null,
      stdout: string,
      stderr: string,
      isRetry: boolean,
    ): void => {
      // Success case
      if (!error) {
        resolve(
          stdout
            .trim()
            .split('\n')
            .map(line => line.replace(/\r$/, ''))
            .filter(Boolean),
        )
        return
      }

      // Exit code 1 is normal "no matches"
      if (error.code === 1) {
        resolve([])
        return
      }

      // Exit code 2 is a usage error (rg was called with invalid flags).
      // It proves rg exists and ran — the caller asked for unsupported
      // behavior, not that rg is broken. Fall back rather than fail so the
      // search still returns something useful.
      if (error.code === 2) {
        logForDebugging(
          `rg exited with code 2 (usage error, stderr: ${stderr}), falling back to native file search`,
        )
        ripGrepFallback(args, target, abortSignal).then(resolve, reject)
        return
      }

      // rg itself could not be started (binary missing or not executable).
      // This is the NORMAL state on this codebase in dev mode — the vendored
      // binary is often absent and the system `rg` may be a broken WASI shim —
      // so surface it in the debug log but still serve the request via the
      // native fallback (which never needs rg).
      const START_ERROR_CODES = ['ENOENT', 'EACCES', 'EPERM']
      if (START_ERROR_CODES.includes(error.code as string)) {
        logForDebugging(
          `rg could not be started (${error.code}), falling back to native file search: ${error.message}`,
        )
        ripGrepFallback(args, target, abortSignal).then(resolve, reject)
        return
      }

      // If we hit EAGAIN and haven't retried yet, retry with single-threaded mode
      // Note: We only use -j 1 for this specific retry, not for future calls.
      // Persisting single-threaded mode globally caused timeouts on large repos
      // where EAGAIN was just a transient startup error.
      if (!isRetry && isEagainError(stderr)) {
        logForDebugging(
          `rg EAGAIN error detected, retrying with single-threaded mode (-j 1)`,
        )

        ripGrepRaw(
          args,
          target,
          abortSignal,
          (retryError, retryStdout, retryStderr) => {
            handleResult(retryError, retryStdout, retryStderr, true)
          },
          true, // Force single-threaded mode for this retry only
        )
        return
      }

      // Unknown/other error (e.g. a broken rg that exits non-zero with no
      // output — the WASI ripgrep shim on Windows fails with os error 52).
      // Fall back to the native walker so search still works; this also
      // fixes the silent-empty-results failure mode when the error carried
      // no output (code !== 2 was previously resolved as "no matches").
      logForDebugging(
        `rg failed (signal=${error.signal}, code=${error.code}, stderr: ${stderr}), falling back to native file search`,
      )
      ripGrepFallback(args, target, abortSignal).then(resolve, reject)
    }

    ripGrepRaw(args, target, abortSignal, (error, stdout, stderr) => {
      handleResult(error, stdout, stderr, false)
    })
  })
}

/**
 * Native fallback for ripgrep — used when rg is unavailable or broken
 * (e.g. the WASI npm shim on Windows that fails all IO with "os error 52").
 *
 * Supports the subset of rg flags the codebase's callers actually use:
 *   --files, --hidden, --no-ignore, --follow, --max-depth N, --glob <pat>,
 *   --sort=modified, -i (case-insensitive regex), -n (line numbers),
 *   -l (files-with-matches), -c (count), -A/-B/-C (context),
 *   --max-columns N, -U --multiline-dotall (multiline regex), -e <pattern>,
 *   --type <name>, plus a positional regex pattern.
 *
 * -m/--max-count stops the search after N matching files (rg's per-file
 * semantics differ slightly, but for the --files/glob use cases here the
 * effect is the same). .gitignore is NOT respected in fallback mode
 * (equivalent to --no-ignore).
 *
 * Returns the same shapes as ripGrep():
 *   - list mode (no -l/-c): lines like `{path}:{content}` (with -n: `{path}:{line}:{content}`)
 *   - -l mode: one path per line (no leading `./`, matching rg's default output)
 *   - -c mode: lines like `{path}:{count}`
 * Paths use forward slashes, matching rg's output format on every platform.
 */
export async function ripGrepFallback(
  args: string[],
  target: string,
  abortSignal: AbortSignal,
): Promise<string[]> {
  const parsed = parseFallbackArgs(args)

  const targetStat = await stat(target).catch(e => {
    throw new Error(
      `ripgrep fallback: stat target directory failed: ${errorMessage(e)}`,
    )
  })
  if (!targetStat.isDirectory()) {
    throw new Error(`ripgrep fallback: target is not a directory: ${target}`)
  }

  const files: string[] = []
  const visitedDirs = new Set<string>()
  let truncated = false
  const limit = parsed.maxCount

  const walk = async (currentDir: string, depth: number): Promise<void> => {
    if (truncated || abortSignal.aborted) return

    // Cycle detection via device+inode, with realpath fallback on Windows.
    // Mirrors findMarkdownFilesNative in markdownConfigLoader.ts.
    try {
      const stats = await stat(currentDir, { bigint: true })
      const dirKey =
        stats.dev !== undefined && stats.ino !== undefined
          ? `${stats.dev}:${stats.ino}`
          : await realpathSafe(currentDir)
      if (visitedDirs.has(dirKey)) return
      visitedDirs.add(dirKey)
    } catch {
      return
    }

    let entries
    try {
      entries = await readdir(currentDir, { withFileTypes: true })
    } catch {
      return
    }

    for (const entry of entries) {
      if (truncated || abortSignal.aborted) return

      // Hidden-file filter — `--hidden` includes them, otherwise skip dotfiles.
      if (!parsed.hidden && entry.name.startsWith('.')) continue

      const fullPath = join(currentDir, entry.name)
      let isDir: boolean
      let isFile: boolean
      if (entry.isSymbolicLink()) {
        if (!parsed.follow) continue
        try {
          const s = await stat(fullPath)
          isDir = s.isDirectory()
          isFile = s.isFile()
        } catch {
          continue
        }
      } else {
        isDir = entry.isDirectory()
        isFile = entry.isFile()
      }

      if (isDir) {
        // Honor --max-depth: rg's depth counts from 0 for the target itself,
        // 1 for its direct children, etc. Only descend while the current
        // depth is below the limit.
        if (parsed.maxDepth === undefined || depth < parsed.maxDepth) {
          await walk(fullPath, depth + 1)
        }
      } else if (isFile) {
        if (parsed.maxDepth !== undefined && depth > parsed.maxDepth) continue
        const rel = relative(target, fullPath).replaceAll('\\', '/')
        if (parsed.glob && !matchesGlob(rel, parsed.glob)) continue
        if (parsed.files) {
          files.push(rel)
        } else {
          const result = await matchFileContent(fullPath, rel, parsed)
          if (result !== null) {
            for (const line of result) {
              files.push(line)
              if (limit !== undefined && files.length >= limit) {
                truncated = true
                return
              }
            }
          }
        }
      }
    }
  }

  await walk(target, 0)

  if (parsed.sortModified) {
    files.sort((a, b) => a.localeCompare(b))
  }
  return files
}

/**
 * Parse the rg-style arg list into a structured set of options.
 * Unknown flags are ignored (keeps the fallback robust to new rg features).
 */
type FallbackArgs = {
  hidden: boolean
  follow: boolean
  noIgnore: boolean
  maxDepth: number | undefined
  maxCount: number | undefined
  glob: string[] | undefined
  sortModified: boolean
  caseInsensitive: boolean
  lineNumbers: boolean
  files: boolean
  filesWithMatches: boolean
  count: boolean
  contextBefore: number
  contextAfter: number
  maxColumns: number
  multiline: boolean
  fileTypes: string[]
  patterns: string[]
}

function parseFallbackArgs(args: string[]): FallbackArgs {
  const parsed: FallbackArgs = {
    hidden: false,
    follow: false,
    noIgnore: false,
    files: false,
    maxDepth: undefined,
    maxCount: undefined,
    glob: undefined,
    sortModified: false,
    caseInsensitive: false,
    lineNumbers: false,
    filesWithMatches: false,
    count: false,
    contextBefore: 0,
    contextAfter: 0,
    maxColumns: 500,
    multiline: false,
    fileTypes: [],
    patterns: [],
  }

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!
    switch (arg) {
      case '--hidden':
        parsed.hidden = true
        break
      case '--no-ignore':
        parsed.noIgnore = true
        break
      case '--follow':
        parsed.follow = true
        break
      case '--files':
        parsed.files = true
        break
      case '--sort=modified':
        parsed.sortModified = true
        break
      case '-i':
      case '--ignore-case':
        parsed.caseInsensitive = true
        break
      case '-n':
      case '--line-number':
        parsed.lineNumbers = true
        break
      case '-l':
      case '--files-with-matches':
        parsed.filesWithMatches = true
        break
      case '-c':
      case '--count':
        parsed.count = true
        break
      case '-U':
      case '--multiline':
        parsed.multiline = true
        break
      case '-e':
        parsed.patterns.push(args[++i]!)
        break
      case '--max-depth': {
        const v = parseInt(args[++i]!, 10)
        if (!isNaN(v)) parsed.maxDepth = v
        break
      }
      case '-m':
      case '--max-count': {
        const v = parseInt(args[++i]!, 10)
        if (!isNaN(v)) parsed.maxCount = v
        break
      }
      case '--glob': {
        const v = args[++i]
        if (v) (parsed.glob ??= []).push(v)
        break
      }
      case '-A': {
        const v = parseInt(args[++i]!, 10)
        if (!isNaN(v)) parsed.contextAfter = v
        break
      }
      case '-B': {
        const v = parseInt(args[++i]!, 10)
        if (!isNaN(v)) parsed.contextBefore = v
        break
      }
      case '-C': {
        const v = parseInt(args[++i]!, 10)
        if (!isNaN(v)) {
          parsed.contextBefore = v
          parsed.contextAfter = v
        }
        break
      }
      case '--max-columns': {
        const v = parseInt(args[++i]!, 10)
        if (!isNaN(v)) parsed.maxColumns = v
        break
      }
      case '--type':
      case '--type-add': {
        const v = args[++i]
        if (v) parsed.fileTypes.push(v)
        break
      }
      case '--': {
        // Everything after -- is a positional pattern
        parsed.patterns.push(...args.slice(i + 1))
        i = args.length
        break
      }
      default:
        if (arg.startsWith('-') && arg !== '-') {
          // Unknown flag — ignore
          break
        }
        parsed.patterns.push(arg)
    }
  }

  return parsed
}

function realpathSafe(p: string): Promise<string> {
  return realpath(p)
}

function matchesGlob(relPath: string, globs: string[]): boolean {
  for (const rawGlob of globs) {
    const negate = rawGlob.startsWith('!')
    const pattern = negate ? rawGlob.slice(1) : rawGlob

    // Convert to a matcher. picomatch handles {a,b} brace expansion,
    // `**` (matches any number of dirs), and `dot:true` so `.hidden` matches.
    const match = picomatch(pattern, { dot: true })
    const isMatch = match(relPath)

    // A negation `!pat` excludes; a positive `pat` includes.
    if (negate) {
      if (isMatch) return false
    } else {
      if (isMatch) return true
    }
  }
  // No positive glob matched → exclude (unless there are only negations).
  const hasPositive = globs.some(g => !g.startsWith('!'))
  return !hasPositive
}

/**
 * Match a single file's contents against the requested pattern(s).
 * Returns formatted result lines, or null if the file doesn't match.
 */
async function matchFileContent(
  filePath: string,
  relPath: string,
  parsed: FallbackArgs,
): Promise<string[] | null> {
  let content: string
  try {
    content = await readFile(filePath, 'utf8')
  } catch {
    return null
  }

  if (parsed.patterns.length === 0) {
    // No pattern — the file is a match (used with --files)
    return [relPath]
  }

  const flags = parsed.caseInsensitive ? 'gi' : 'g'
  const regexes = parsed.patterns.map(pattern => {
    try {
      return new RegExp(pattern, flags)
    } catch {
      return null
    }
  })

  const effectiveRegexes = regexes.filter(
    (r): r is RegExp => r !== null,
  )
  if (effectiveRegexes.length === 0) {
    return null
  }

  // Simplification: any-regex-matches. A regex that matches "everywhere"
  // (e.g. `.` in multiline mode) matches the file.
  const anyMatch = (line: string): boolean =>
    effectiveRegexes.some(re => re.test(line))

  const lines = content.split('\n')
  const matchedLineIndexes: number[] = []
  for (let i = 0; i < lines.length; i++) {
    if (anyMatch(lines[i]!)) matchedLineIndexes.push(i)
  }

  if (matchedLineIndexes.length === 0) {
    // With -c or -l, empty is fine; for content mode return null (no match).
    return null
  }

  if (parsed.filesWithMatches) return [relPath]
  if (parsed.count) return [`${relPath}:${matchedLineIndexes.length}`]

  // Content mode: format lines like rg — {rel}:{content} or {rel}:{line}:{content}
  // with optional context lines. Context lines are formatted `{rel}-{content}`
  // or `{rel}-{line}-{content}` (rg uses a different separator for context).
  const contextLines = new Set<number>()
  for (const idx of matchedLineIndexes) {
    for (let j = 1; j <= parsed.contextBefore; j++) {
      if (idx - j >= 0) contextLines.add(idx - j)
    }
    for (let j = 1; j <= parsed.contextAfter; j++) {
      if (idx + j < lines.length) contextLines.add(idx + j)
    }
  }

  const result: string[] = []
  for (const idx of matchedLineIndexes) {
    const line = lines[idx]!
    // Truncate long lines to --max-columns
    const shown =
      parsed.maxColumns > 0 && line.length > parsed.maxColumns
        ? line.slice(0, parsed.maxColumns) + '…'
        : line
    const prefix = parsed.lineNumbers
      ? `${relPath}:${idx + 1}:`
      : `${relPath}:`
    result.push(prefix + shown)

    // Add context lines after the match (rg uses `-` as the path separator
    // for context lines)
    for (let j = 1; j <= parsed.contextAfter; j++) {
      if (idx + j >= lines.length) break
      const ctxLine = lines[idx + j]!
      const ctxShown =
        parsed.maxColumns > 0 && ctxLine.length > parsed.maxColumns
          ? ctxLine.slice(0, parsed.maxColumns) + '…'
          : ctxLine
      const ctxPrefix = parsed.lineNumbers
        ? `${relPath}-${idx + j + 1}-`
        : `${relPath}-`
      result.push(ctxPrefix + ctxShown)
    }
  }

  return result
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Count files in a directory recursively using ripgrep and round to the nearest power of 10 for privacy
 *
 * This is much more efficient than using native Node.js methods for counting files
 * in large directories since it uses ripgrep's highly optimized file traversal.
 *
 * @param path Directory path to count files in
 * @param abortSignal AbortSignal to cancel the operation
 * @param ignorePatterns Optional additional patterns to ignore (beyond .gitignore)
 * @returns Approximate file count rounded to the nearest power of 10
 */
export const countFilesRoundedRg = memoize(
  async (
    dirPath: string,
    abortSignal: AbortSignal,
    ignorePatterns: string[] = [],
  ): Promise<number | undefined> => {
    // Skip file counting if we're in the home directory to avoid triggering
    // macOS TCC permission dialogs for Desktop, Downloads, Documents, etc.
    if (path.resolve(dirPath) === path.resolve(homedir())) {
      return undefined
    }

    try {
      // Build ripgrep arguments:
      // --files: List files that would be searched (rather than searching them)
      // --count: Only print a count of matching lines for each file
      // --no-ignore-parent: Don't respect ignore files in parent directories
      // --hidden: Search hidden files and directories
      const args = ['--files', '--hidden']

      // Add ignore patterns if provided
      ignorePatterns.forEach(pattern => {
        args.push('--glob', `!${pattern}`)
      })

      const count = await ripGrepFileCount(args, dirPath, abortSignal)

      // Round to nearest power of 10 for privacy
      if (count === 0) return 0

      const magnitude = Math.floor(Math.log10(count))
      const power = Math.pow(10, magnitude)

      // Round to nearest power of 10
      // e.g., 8 -> 10, 42 -> 100, 350 -> 100, 750 -> 1000
      return Math.round(count / power) * power
    } catch (error) {
      // AbortSignal.timeout firing is expected on large/slow repos, not an error.
      if ((error as Error)?.name !== 'AbortError') logError(error)
    }
  },
  // lodash memoize's default resolver only uses the first argument.
  // ignorePatterns affect the result, so include them in the cache key.
  // abortSignal is intentionally excluded — it doesn't affect the count.
  (dirPath, _abortSignal, ignorePatterns = []) =>
    `${dirPath}|${ignorePatterns.join(',')}`,
)

// Singleton to store ripgrep availability status
let ripgrepStatus: {
  working: boolean
  lastTested: number
  config: RipgrepConfig
} | null = null

/**
 * Get ripgrep status and configuration info
 * Returns current configuration immediately, with working status if available
 */
export function getRipgrepStatus(): {
  mode: RipgrepConfig['mode']
  path: string
  working: boolean | null // null if not yet tested
} {
  const config = getRipgrepConfig()
  return {
    mode: config.mode,
    path: config.command,
    working: ripgrepStatus?.working ?? null,
  }
}

/**
 * Test ripgrep availability on first use and cache the result
 */
const testRipgrepOnFirstUse = memoize(async (): Promise<void> => {
  // Already tested
  if (ripgrepStatus !== null) {
    return
  }

  const config = getRipgrepConfig()

  try {
    let test: { code: number; stdout: string }

    // For embedded ripgrep, use Bun.spawn with argv0
    if (config.argv0) {
      // Only Bun embeds ripgrep.
      // eslint-disable-next-line custom-rules/require-bun-typeof-guard
      const proc = Bun.spawn([config.command, '--version'], {
        argv0: config.argv0,
        stderr: 'ignore',
        stdout: 'pipe',
      })

      // Bun's ReadableStream has .text() at runtime, but TS types don't reflect it
      const [stdout, code] = await Promise.all([
        (proc.stdout as unknown as Blob).text(),
        proc.exited,
      ])
      test = {
        code,
        stdout,
      }
    } else {
      test = await execFileNoThrow(
        config.command,
        [...config.args, '--version'],
        {
          timeout: 5000,
        },
      )
    }

    const working =
      test.code === 0 && !!test.stdout && test.stdout.startsWith('ripgrep ')

    ripgrepStatus = {
      working,
      lastTested: Date.now(),
      config,
    }

    logForDebugging(
      `Ripgrep first use test: ${working ? 'PASSED' : 'FAILED'} (mode=${config.mode}, path=${config.command})`,
    )

    // Log telemetry for actual ripgrep availability

  } catch (error) {
    ripgrepStatus = {
      working: false,
      lastTested: Date.now(),
      config,
    }
    logError(error)
  }
})

let alreadyDoneSignCheck = false
async function codesignRipgrepIfNecessary() {
  if (process.platform !== 'darwin' || alreadyDoneSignCheck) {
    return
  }

  alreadyDoneSignCheck = true

  // Only sign the standalone vendored rg binary (npm builds)
  const config = getRipgrepConfig()
  if (config.mode !== 'builtin') {
    return
  }
  const builtinPath = config.command

  // First, check to see if ripgrep is already signed
  const lines = (
    await execFileNoThrow('codesign', ['-vv', '-d', builtinPath], {
      preserveOutputOnError: false,
    })
  ).stdout.split('\n')

  const needsSigned = lines.find(line => line.includes('linker-signed'))
  if (!needsSigned) {
    return
  }

  try {
    const signResult = await execFileNoThrow('codesign', [
      '--sign',
      '-',
      '--force',
      '--preserve-metadata=entitlements,requirements,flags,runtime',
      builtinPath,
    ])

    if (signResult.code !== 0) {
      logError(
        new Error(
          `Failed to sign ripgrep: ${signResult.stdout} ${signResult.stderr}`,
        ),
      )
    }

    const quarantineResult = await execFileNoThrow('xattr', [
      '-d',
      'com.apple.quarantine',
      builtinPath,
    ])

    if (quarantineResult.code !== 0) {
      logError(
        new Error(
          `Failed to remove quarantine: ${quarantineResult.stdout} ${quarantineResult.stderr}`,
        ),
      )
    }
  } catch (e) {
    logError(e)
  }
}
