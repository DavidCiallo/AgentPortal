/**
 * Build a standalone Windows executable for the Portal web UI.
 *
 * Output: dist/exe/portal.exe   (self-contained, ~90 MB, no Bun runtime required;
 *                                web/ static assets are embedded into the binary)
 *
 * Run with:  bun run scripts/build-exe.ts
 * Optionally pass a target triple:  bun run scripts/build-exe.ts -- --target=bun-windows-x64
 */

import { spawnSync } from 'node:child_process'
import { mkdirSync, rmSync, existsSync, cpSync } from 'node:fs'
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
  // The web/ static assets are embedded automatically via the
  // `with { type: 'file' }` imports in src/web/server.ts, so the exe is
  // fully self-contained — no web/ folder is needed next to it at runtime.
  // Embed the project favicon instead of the default Bun icon.
  `--windows-icon=${join(root, 'web', 'favicon.ico')}`,
]
if (target) args.push('--target', target)

console.log('[build-exe] bun ' + args.join(' '))
const result = spawnSync('bun', args, { stdio: 'inherit', cwd: root, shell: process.platform === 'win32' })
if (result.status !== 0) {
  console.error('[build-exe] bun build failed with exit code', result.status)
  process.exit(result.status ?? 1)
}

// Ship the saved provider profile next to the binary. start-web.ts loads
// .portal-profile.json from the process cwd, so without this the exe would
// fail provider validation when run from its own directory in a shell that
// lacks the OPENAI_* env vars (e.g. cmd.exe).
const profileName = '.portal-profile.json'
const profileSrc = join(root, profileName)
if (existsSync(profileSrc)) {
  console.log('[build-exe] Copying .portal-profile.json →', outDir)
  cpSync(profileSrc, join(outDir, profileName))
} else {
  console.log('[build-exe] NOTE: no .portal-profile.json at repo root; exe will rely on shell env for provider config.')
}

console.log('')
console.log('[build-exe] Done.')
console.log('  Binary:', exePath)
console.log('  Run:    ', `${exePath} --port 3212`)
console.log('          ', `${exePath}              (random free port)`)
