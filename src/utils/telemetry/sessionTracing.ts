/**
 * Stub for removed session tracing module.
 */

export function startInteractionSpan(...params: any): void {}

export function endInteractionSpan(...params: any): void {}

export function startToolExecutionSpan(...params: any): void {}

export function endToolExecutionSpan(...params: any): void {}

export function startToolSpan(...params: any): void {}

export function endToolSpan(...params: any): void {}

export function startToolBlockedOnUserSpan(...params: any): void {}

export function endToolBlockedOnUserSpan(...params: any): void {}

export function addToolContentEvent(...params: any): void {}

export function isBetaTracingEnabled(...params: any): boolean {
  return false
}

export function startLLMRequestSpan(...params: any): Span {
  return { end: () => {} }
}

export function endLLMRequestSpan(...params: any): void {}

export type Span = {
  end: () => void
}
