/**
 * Minimal helpers extracted from the deleted terminalSetup command.
 * All functions are simple global-config readers — no CLI/UI coupling.
 */
import { getGlobalConfig } from './config.js'
import { env } from './env.js'

const NATIVE_CSIU_TERMINALS: Record<string, string> = {
  ghostty: 'Ghostty',
  kitty: 'Kitty',
  'iTerm.app': 'iTerm2',
  WezTerm: 'WezTerm',
  WarpTerminal: 'Warp',
}

export function markBackslashReturnUsed(): void {
  const config = getGlobalConfig()
  if (!config.hasUsedBackslashReturn) {
    // Config writing removed — the /terminal-setup command no longer exists.
    // This is now a no-op kept for API compatibility.
  }
}

export function hasUsedBackslashReturn(): boolean {
  return getGlobalConfig().hasUsedBackslashReturn === true
}

export function isShiftEnterKeyBindingInstalled(): boolean {
  return getGlobalConfig().shiftEnterKeyBindingInstalled === true
}

export function shouldOfferTerminalSetup(): boolean {
  return (
    (process.platform === 'darwin' && env.terminal === 'Apple_Terminal') ||
    env.terminal === 'vscode' ||
    env.terminal === 'cursor' ||
    env.terminal === 'windsurf' ||
    env.terminal === 'alacritty' ||
    env.terminal === 'zed'
  )
}

export function getNativeCSIuTerminalDisplayName(): string | null {
  if (!env.terminal || !(env.terminal in NATIVE_CSIU_TERMINALS)) {
    return null
  }
  return NATIVE_CSIU_TERMINALS[env.terminal] ?? null
}
