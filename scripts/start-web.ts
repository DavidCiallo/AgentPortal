import { WebServer } from '../src/web/server'
import { init } from '../src/entrypoints/init'

// Polyfill MACRO which is normally injected by the bundler
Object.assign(globalThis, {
  MACRO: {
    VERSION: '0.2.3',
    DISPLAY_VERSION: '0.2.3',
    PACKAGE_URL: '@gitlawb/portal',
  }
})

async function main() {
  console.log('Starting Portal Web UI...')
  await init()

  // Mirror CLI bootstrap: hydrate secure tokens and resolve provider profile
  const { enableConfigs } = await import('../src/utils/config.js')
  enableConfigs()
  const { applySafeConfigEnvironmentVariables } = await import('../src/utils/managedEnv.js')
  applySafeConfigEnvironmentVariables()

  const { buildStartupEnvFromProfile, applyProfileEnvToProcessEnv } = await import('../src/utils/providerProfile.js')
  const { getProviderValidationError, validateProviderEnvOrExit } = await import('../src/utils/providerValidation.js')
  const startupEnv = await buildStartupEnvFromProfile({ processEnv: process.env })
  if (startupEnv !== process.env) {
    const startupProfileError = await getProviderValidationError(startupEnv)
    if (startupProfileError) {
      console.warn(`Warning: ignoring saved provider profile. ${startupProfileError}`)
    } else {
      applyProfileEnvToProcessEnv(process.env, startupEnv)
    }
  }
  await validateProviderEnvOrExit()
  console.log('Provider environment validated successfully.')
  const port = process.env.WEB_PORT ? parseInt(process.env.WEB_PORT, 10) : 3200
  const host = process.env.WEB_HOST || '0.0.0.0'

  const server = new WebServer({ port, host })
  server.start()
}

main().catch((err) => {
  console.error('Fatal error starting web server:', err)
  process.exit(1)
})
