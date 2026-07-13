/**
 * Stub — original CLI keybinding module removed. Returns the fallback
 * shortcut display text directly since user keybinding config is not
 * available in web-only context.
 */
import type { KeybindingContextName } from './types.js'

export function getShortcutDisplay(
  _action: string,
  _context: KeybindingContextName,
  fallback: string,
): string {
  return fallback
}
