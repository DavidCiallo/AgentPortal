/**
 * Stub module for analytics types and functions.
 * This module provides no-op implementations for analytics functionality
 * that has been removed in the Portal fork.
 */

// Type stubs for analytics metadata
export type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS = string
export type AnalyticsMetadata_I_VERIFIED_THIS_IS_PII_TAGGED = string

// No-op function stubs
export function logEvent(_event: string, _data?: Record<string, unknown>): void {
  // no-op
}

export function logEventAsync(_event: string, _data?: Record<string, unknown>): Promise<void> {
  return Promise.resolve()
}

export function attachAnalyticsSink(_sink: unknown): void {
  // no-op
}

export function stripProtoFields(_data: Record<string, unknown>): Record<string, unknown> {
  return _data
}

export function _resetForTesting(): void {
  // no-op
}
