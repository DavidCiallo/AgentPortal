/**
 * Stub for Claude AI rate limits - not applicable for OpenAI-compatible providers.
 */

type QuotaStatus = 'allowed' | 'allowed_warning' | 'rejected'

export type RateLimitType =
  | 'five_hour'
  | 'seven_day'
  | 'seven_day_opus'
  | 'seven_day_sonnet'
  | 'overage'

export type ClaudeAILimits = {
  status: QuotaStatus
  unifiedRateLimitFallbackAvailable: boolean
  resetsAt?: number
  rateLimitType?: RateLimitType
  utilization?: number
  overageStatus?: QuotaStatus
  overageResetsAt?: number
  isUsingOverage?: boolean
  surpassedThreshold?: number
}

export let currentLimits: ClaudeAILimits = {
  status: 'allowed',
  unifiedRateLimitFallbackAvailable: false,
  isUsingOverage: false,
}

export function emitStatusChange(limits: ClaudeAILimits): void {
  currentLimits = limits
}

export function extractQuotaStatusFromHeaders(_headers: globalThis.Headers): void {
  // No-op for OpenAI-compatible providers
}

export function extractQuotaStatusFromError(_error: unknown): void {
  // No-op for OpenAI-compatible providers
}

export function getRateLimitDisplayName(type: RateLimitType): string {
  const names: Record<RateLimitType, string> = {
    five_hour: 'session limit',
    seven_day: 'weekly limit',
    seven_day_opus: 'Opus limit',
    seven_day_sonnet: 'Sonnet limit',
    overage: 'extra usage limit',
  }
  return names[type] || type
}

export function getRateLimitErrorMessage(): string {
  return ''
}

export function getRateLimitWarning(): string {
  return ''
}

export function getUsingOverageText(): string {
  return ''
}

export function checkQuotaStatus(): Promise<void> {
  return Promise.resolve()
}

type RawWindowUtilization = {
  utilization: number
  resets_at: number
}

type RawUtilization = {
  five_hour?: RawWindowUtilization
  seven_day?: RawWindowUtilization
}

export function getRawUtilization(): RawUtilization {
  return {}
}

type StatusChangeListener = (limits: ClaudeAILimits) => void
export const statusListeners: Set<StatusChangeListener> = new Set()
