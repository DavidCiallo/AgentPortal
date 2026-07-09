/**
 * Stub for removed plugin telemetry module.
 */

export function buildPluginTelemetryFields(): Record<string, unknown> {
  return {}
}

export function buildPluginCommandTelemetryFields(): Record<string, unknown> {
  return {}
}

export function classifyPluginCommandError(_error: unknown): string {
  return 'unknown'
}
