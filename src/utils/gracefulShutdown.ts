/**
 * Stub — terminal graceful shutdown. In web mode, shutdown is handled
 * by the HTTP server lifecycle, not terminal signals.
 */

let _isShuttingDown = false

export function isShuttingDown(): boolean {
  return _isShuttingDown
}

export function gracefulShutdown(): void {
  _isShuttingDown = true
}

export function gracefulShutdownSync(): void {
  _isShuttingDown = true
}
