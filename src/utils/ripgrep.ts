import { readdir, readFile, realpath, stat } from 'fs/promises'
import picomatch from 'picomatch'
import { homedir } from 'os'
import * as path from 'path'
import { join, relative } from 'path'
import { errorMessage } from './errors.js'
import { logError } from './log.js'
import { countCharInString } from './stringUtils.js'

/**
 * Native file search.
 *
 * This module is the single file-search implementation used by the Grep, Glob,
 * and file-index paths. There is intentionally no ripgrep integration:
 * spawning `rg` (or re-spawning the app binary in "embedded" argv0 mode) is
 * not reliable in bundled builds, so searches walk the filesystem directly
 * with Node's `fs` APIs and `picomatch` for glob matching.
 *
 * Supported rg-style flags (the subset the codebase's callers actually use):
 *   --files, --hidden, --no-ignore, --follow, --max-depth N, --glob <pat>,
 *   --sort=modified, -i (case-insensitive), -n (line numbers),
 *   -l (files-with-matches), -c (count), -A/-B/-C (context),
 *   --max-columns N, -U --multiline-dotall, -e <pattern>, --type <name>,
 *   plus a positional regex pattern.
 *
 * -m/--max-count stops the search after N matching files. .gitignore is NOT
 * respected (equivalent to rg's --no-ignore). `--type <name>` is parsed but
 * not applied (see the docs above `matchFileContent`).
 *
 * Output shapes match ripgrep's:
 *   - list mode (no -l/-c): lines like `{path}:{content}` (with -n: `{path}:{line}:{content}`)
 *   - -l mode: one path per line (no leading `./`)
 *   - -c mode: lines like `{path}:{count}`
 * Paths use forward slashes.
 */

function ripGrepRaw(
  args: string[],
  target: string,
  abortSignal: AbortSignal,
  callback: (
    error: NodeJS.ErrnoException | null,
    stdout: string,
    stderr: string,
  ) => void,
  _singleThread = false,
): { kill: () => void } {
  ripGrepFallback(args, target, abortSignal)
    .then(stdout => callback(null, stdout.join('\n'), ''))
    .catch((err: unknown) => {
      const e = new Error(
        `Native search failed: ${errorMessage(err)}`,
      ) as NodeJS.ErrnoException
      if (err instanceof Error && 'code' in err) {
        e.code = (err as NodeJS.ErrnoException).code
      }
      callback(e, '', '')
    })

  // No external process to kill — aborting the signal stops the walker.
  return { kill: () => {} }
}

/**
 * Stream file paths from the native walker, flushing complete lines per chunk.
 *
 * Unlike `ripGrep()` (which buffers everything), this flushes results as the
 * walker finds them — first results paint before the tree walk finishes.
 * Partial trailing lines are carried across chunks.
 *
 * Callers that want to stop early (e.g. after N matches) should abort the
 * signal — the walker checks it between files.
 */
export async function ripGrepStream(
  args: string[],
  target: string,
  abortSignal: AbortSignal,
  onLines: (lines: string[]) => void,
): Promise<void> {
  // Stream mode is not exercised by any current caller; fall back to the
  // buffered walker and flush full lines only.
  const stdout = await ripGrep(args, target, abortSignal)
  const stripCR = (l: string) => (l.endsWith('\r') ? l.slice(0, -1) : l)
  if (stdout.length) onLines(stdout.map(stripCR))
}

/**
 * Search using the native walker. Resolves with rg-compatible output lines.
 * Aborting the signal stops the walk; an abort surfaces as an AbortError
 * rejection from the walker.
 *
 * (Formerly this wrapped ripgrep; the rg "exit code 1 = no matches"
 * convention is now handled natively by the walker returning []).
 */
export async function ripGrep(
  args: string[],
  target: string,
  abortSignal: AbortSignal,
): Promise<string[]> {
  return ripGrepFallback(args, target, abortSignal)
}

/**
 * Count files in a directory recursively and round to the nearest power of 10
 * for privacy.
 *
 * @param dirPath Directory path to count files in
 * @param abortSignal AbortSignal to cancel the operation
 * @param ignorePatterns Optional additional patterns to ignore
 * @returns Approximate file count rounded to the nearest power of 10
 */
export const countFilesRoundedRg = memoize(
  async (
    dirPath: string,
    abortSignal: AbortSignal,
    ignorePatterns: string[] = [],
  ): Promise<number | undefined> => {
    // Skip file counting in the home directory to avoid triggering
    // permission dialogs for Desktop, Downloads, Documents, etc.
    if (path.resolve(dirPath) === path.resolve(homedir())) {
      return undefined
    }

    try {
      const args = ['--files', '--hidden']
      ignorePatterns.forEach(pattern => {
        args.push('--glob', `!${pattern}`)
      })

      const count = await ripGrepFileCount(args, dirPath, abortSignal)

      // Round to nearest power of 10 for privacy
      if (count === 0) return 0

      const magnitude = Math.floor(Math.log10(count))
      const power = Math.pow(10, magnitude)
      return Math.round(count / power) * power
    } catch (error) {
      // AbortSignal.timeout firing is expected on large/slow repos, not an error.
      if ((error as Error)?.name !== 'AbortError') logError(error)
    }
  },
  // ignorePatterns affect the result, so include them in the cache key.
  // abortSignal is intentionally excluded — it doesn't affect the count.
  (dirPath, _abortSignal, ignorePatterns = []) =>
    `${dirPath}|${ignorePatterns.join(',')}`,
)

/**
 * Count lines from the native walker without materializing the full output.
 * The only caller is telemetry (countFilesRoundedRg), which swallows errors.
 */
async function ripGrepFileCount(
  args: string[],
  target: string,
  abortSignal: AbortSignal,
): Promise<number> {
  const files = await ripGrepFallback(args, target, abortSignal)
  return countCharInString(files.join('\n'), '\n') + (files.length > 0 ? 1 : 0)
}

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

/**
 * Native fallback for file search — the primary (and only) search path.
 *
 * Supports the flag subset above and returns rg-compatible output.
 */
export async function ripGrepFallback(
  args: string[],
  target: string,
  abortSignal: AbortSignal,
): Promise<string[]> {
  const parsed = parseFallbackArgs(args)

  const targetStat = await stat(target).catch(e => {
    throw new Error(
      `Native search: stat target directory failed: ${errorMessage(e)}`,
    )
  })
  if (!targetStat.isDirectory()) {
    throw new Error(`Native search: target is not a directory: ${target}`)
  }

  const files: string[] = []
  const visitedDirs = new Set<string>()
  let truncated = false
  const limit = parsed.maxCount

  const walk = async (currentDir: string, depth: number): Promise<void> => {
    if (truncated || abortSignal.aborted) return

    // Cycle detection via device+inode, with realpath fallback on Windows.
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
        // Honor --max-depth: depth counts from 0 for the target itself,
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

function realpathSafe(p: string): Promise<string> {
  return realpath(p)
}

function matchesGlob(relPath: string, globs: string[]): boolean {
  for (const rawGlob of globs) {
    const negate = rawGlob.startsWith('!')
    const pattern = negate ? rawGlob.slice(1) : rawGlob

    // picomatch handles {a,b} brace expansion, `**` (matches any number of
    // dirs), and `dot:true` so `.hidden` matches.
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
 *
 * Note: `--type <name>` is parsed into `parsed.fileTypes` but not applied
 * here — the walker does not filter by language type. Callers that need type
 * filtering pass an equivalent `--glob` (the Grep tool's type parameter maps
 * to a glob in practice).
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

  // Content mode: format lines like {rel}:{content} or {rel}:{line}:{content}
  // with optional context lines. Context lines are formatted `{rel}-{content}`
  // or `{rel}-{line}-{content}`.
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

    // Add context lines after the match
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

type MemoizeResolver<T extends (...args: never[]) => unknown> = (
  ...args: Parameters<T>
) => string

function memoize<T extends (...args: never[]) => unknown>(
  fn: T,
  resolver?: MemoizeResolver<T>,
): T {
  const cache = new Map<string, ReturnType<T>>()
  return ((...args: Parameters<T>): ReturnType<T> => {
    const key = resolver ? resolver(...args) : JSON.stringify(args)
    if (cache.has(key)) return cache.get(key) as ReturnType<T>
    const result = fn(...args)
    cache.set(key, result as ReturnType<T>)
    return result as ReturnType<T>
  }) as T
}
