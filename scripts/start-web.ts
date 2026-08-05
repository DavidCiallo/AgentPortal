import { WebServer } from '../src/web/server'
import { init } from '../src/entrypoints/init'
import { spawn } from 'node:child_process'

// Polyfill MACRO which is normally injected by the bundler
Object.assign(globalThis, {
  MACRO: {
    VERSION: '0.2.3',
    DISPLAY_VERSION: '0.2.3',
    PACKAGE_URL: '@gitlawb/portal',
  }
})

interface CliOptions {
  port?: number
  host?: string
  webRoot?: string
  open?: boolean
}

function parseArgs(argv: string[]): CliOptions {
  const opts: CliOptions = { open: false }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--port' || arg === '-p') {
      const v = parseInt(argv[++i], 10)
      if (Number.isFinite(v) && v > 0 && v < 65536) opts.port = v
    } else if (arg === '--host' || arg === '-h') {
      opts.host = argv[++i]
    } else if (arg === '--web-root') {
      opts.webRoot = argv[++i]
    } else if (arg === '--open') {
      opts.open = true
    } else if (arg === '--no-open') {
      opts.open = false
    } else if (arg === '--help') {
      console.log(`Portal Web UI

Usage: portal-web [options]

Options:
  --port <number>     Port to listen on (default: random free port)
  --host <addr>       Host/interface to bind (default: 0.0.0.0)
  --web-root <path>   Path to the web/ static assets directory
  --open              Open the browser after start
  --no-open           Do not open the browser after start (default)
  --help              Show this help
`)
      process.exit(0)
    }
  }
  // Env vars remain supported as a fallback (matches previous behavior)
  if (!opts.port && process.env.WEB_PORT) {
    const v = parseInt(process.env.WEB_PORT, 10)
    if (Number.isFinite(v) && v > 0 && v < 65536) opts.port = v
  }
  if (!opts.host && process.env.WEB_HOST) opts.host = process.env.WEB_HOST
  return opts
}

/** Open the default browser at url using the platform's opener. */
function openBrowser(url: string) {
  const { platform } = process
  const cmd = platform === 'win32' ? 'cmd'
    : platform === 'darwin' ? 'open'
    : 'xdg-open'
  const args = platform === 'win32' ? ['/c', 'start', '', url] : [url]
  const child = spawn(cmd, args, { stdio: 'ignore', detached: true })
  // Never let a missing opener (e.g. headless server) take the process down.
  child.on('error', () => {})
  child.unref()
}

async function main() {
  const opts = parseArgs(process.argv.slice(2))
  console.log('Starting Portal Web UI...')
  await init()

  // Mirror CLI bootstrap: hydrate secure tokens and resolve provider profile
  const { enableConfigs } = await import('../src/utils/config.js')
  enableConfigs()
  const { applySafeConfigEnvironmentVariables } = await import('../src/utils/managedEnv.js')
  applySafeConfigEnvironmentVariables()

  const { buildStartupEnvFromProfile, applyProfileEnvToProcessEnv } = await import('../src/utils/providerProfile.js')
  const { getProviderValidationError } = await import('../src/utils/providerValidation.js')
  const startupEnv = await buildStartupEnvFromProfile({ processEnv: process.env })
  if (startupEnv !== process.env) {
    const startupProfileError = await getProviderValidationError(startupEnv)
    if (startupProfileError) {
      console.warn(`Warning: ignoring saved provider profile. ${startupProfileError}`)
    } else {
      applyProfileEnvToProcessEnv(process.env, startupEnv)
    }
  }

  // A missing/placeholder API key must not prevent the UI from starting:
  // the user can still configure the provider in Settings or via the saved
  // profile. Only actual chat requests will fail until a key is set.
  const providerError = await getProviderValidationError(process.env)
  if (providerError) {
    console.warn(`Warning: ${providerError}`)
  } else {
    console.log('Provider environment validated successfully.')
  }

  const host = opts.host || '0.0.0.0'
  const server = new WebServer({ port: opts.port, host, webRoot: opts.webRoot })
  await server.start()

  if (opts.open) {
    console.log(`Opening browser at ${server.localUrl}`)
    openBrowser(server.localUrl)
  }
}

main().catch((err) => {
  console.error('Fatal error starting web server:', err)
  process.exit(1)
})
