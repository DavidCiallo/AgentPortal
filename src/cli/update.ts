import chalk from 'chalk'
import { writeToStdout } from 'src/utils/process.js'

export async function update() {
  // Block updates for non-first-party providers. The update mechanism downloads
  // from the first-party distribution bucket, which would silently replace the
  // Portal build (with the OpenAI shim) with the upstream Claude Code
  // binary (without it).
  writeToStdout(
    chalk.yellow('Auto-update is not available for non-first-party provider builds.\n') +
    'To update, pull the latest source from the repository and rebuild:\n' +
    '  git pull && bun install && bun run build\n',
  )
  return
}
