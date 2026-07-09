import type { Command } from '../../commands.js'

const desktop: Command = {
  type: 'local-jsx',
  name: 'desktop',
  description: 'Desktop integration (removed)',
  isEnabled: false,
  load: () => Promise.resolve({ default: () => null }),
}

export default desktop
