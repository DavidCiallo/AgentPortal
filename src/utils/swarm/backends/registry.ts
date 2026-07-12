/** Stub for removed swarm/backends/registry.ts */

import type { BackendType } from './types.js'

export function isInProcessEnabled(): boolean {
  return false
}

export function getCachedDetectionResult(): BackendType | null {
  return null
}

export function detectAndGetBackend(): BackendType | null {
  return null
}

export function getBackendByType(_type: BackendType): unknown {
  return null
}

export function markInProcessFallback(): void {}

export function resetBackendDetection(): void {}
