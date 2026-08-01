/**
 * Build a standalone Windows executable for the Portal web UI.
 *
 * Output: dist/exe/portal.exe   (self-contained, ~90 MB, no Bun runtime required)
 *         dist/exe/web/...      (static assets copied next to the binary)
 *
 * Run with:  bun run scripts/build-exe.ts
 * Optionally pass a target triple:  bun run scripts/build-exe.ts -- --target=bun-windows-x64
 */

import { spawnSync } from 'node:child_process'
import { cpSync, mkdirSync, rmSync, existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = resolve(__dirname, '..')
const outDir = join(root, 'dist', 'exe')
const entry = join(root, 'scripts', 'start-web.ts')

function parseTarget(): string | undefined {
  const idx = process.argv.indexOf('--target')
  if (idx !== -1 && process.argv[idx + 1]) return process.argv[idx + 1]
  const eq = process.argv.find(a => a.startsWith('--target='))
  if (eq) return eq.slice('--target='.length)
  return undefined
}

const target = parseTarget()
const exeName = process.platform === 'win32' ? 'portal.exe' : 'portal'
const exePath = join(outDir, exeName)

console.log('[build-exe] Cleaning', outDir)
rmSync(outDir, { recursive: true, force: true })
mkdirSync(outDir, { recursive: true })

const args = [
  'build',
  entry,
  '--compile',
  '--outfile', exePath,
  '--minify',
  // Optional packages that are only resolved at runtime via dynamic import().
  // Excluding them keeps the binary self-contained for the default web UI
  // without forcing every optional dependency to be installed at build time.
  '--external', '@anthropic-ai/mcpb',
]
if (target) args.push('--target', target)

console.log('[build-exe] bun ' + args.join(' '))
const result = spawnSync('bun', args, { stdio: 'inherit', cwd: root, shell: process.platform === 'win32' })
if (result.status !== 0) {
  console.error('[build-exe] bun build failed with exit code', result.status)
  process.exit(result.status ?? 1)
}

// Copy web/ next to the binary so resolveWebRoot() can find it at runtime.
const webSrc = join(root, 'web')
const webDst = join(outDir, 'web')
if (!existsSync(webSrc)) {
  console.error('[build-exe] WARNING: web/ directory not found at', webSrc)
} else {
  console.log('[build-exe] Copying web/ →', webDst)
  cpSync(webSrc, webDst, { recursive: true })
}

console.log('')
console.log('[build-exe] Done.')
console.log('  Binary:', exePath)
console.log('  Run:    ', `${exePath} --port 3212`)
console.log('          ', `${exePath}              (random free port)`)
