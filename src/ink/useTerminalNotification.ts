/**
 * Stub — terminal notification type for shared code that references it.
 */
export type TerminalNotification = {
  notifyITerm2: (opts: { message: string; title?: string }) => void
  notifyKitty: (opts: { message: string; title: string; id: number }) => void
  notifyGhostty: (opts: { message: string; title: string }) => void
  notifyBell: () => void
  reportProgress: (state: { current: number; total: number; label?: string } | null) => void
}
