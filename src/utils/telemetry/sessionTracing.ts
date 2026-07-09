/**
 * Stub for removed session tracing module.
 */

export function startInteractionSpan(): void {}

export function endInteractionSpan(): void {}

export function startToolExecutionSpan(): void {}

export function endToolExecutionSpan(): void {}

export function startToolSpan(): void {}

export function endToolSpan(): void {}

export function startToolBlockedOnUserSpan(): void {}

export function endToolBlockedOnUserSpan(): void {}

export function addToolContentEvent(): void {}

export function isBetaTracingEnabled(): boolean {
  return false
}

export function startLLMRequestSpan(): Span {
  return { end: () => {} }
}

export function endLLMRequestSpan(): void {}

export type Span = {
  end: () => void
}
