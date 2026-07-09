/**
 * Stub for removed telemetry events module.
 */

export function logOTelEvent(_name: string, _attributes?: Record<string, string>): void {}

export function redactIfDisabled(text: string): string {
  return '[redacted]'
}
