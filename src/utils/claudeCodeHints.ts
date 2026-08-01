/** Stub — original CLI hints module removed */
export const claudeCodeHints = { get: () => [] }

// No-op stubs for callers of the removed hint-recording API.
// Functionality was removed in dead-code-elimination; these exist only so
// static imports in hintRecommendation.ts resolve at bundle time.
export type ClaudeCodeHint = { type: 'plugin'; value: string }

export function hasShownHintThisSession(): boolean {
  return false
}

export function setPendingHint(_hint: ClaudeCodeHint): void {
  // no-op
}

export function extractClaudeCodeHints(_stdout: string, _command?: string): ClaudeCodeHint[] {
  return []
}
