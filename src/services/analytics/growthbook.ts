/**
 * Stub module for GrowthBook functionality.
 * This module provides no-op implementations for GrowthBook feature flag
 * functionality that has been removed in the Portal fork.
 */

export function initializeGrowthBook(): Promise<void> {
  return Promise.resolve()
}

export function refreshGrowthBookAfterAuthChange(): Promise<void> {
  return Promise.resolve()
}

export function getFeatureValue_CACHED_MAY_BE_STALE<T>(_key: string, _defaultValue: T): T {
  return _defaultValue
}

export function hasGrowthBookEnvOverride(): boolean {
  return false
}

export function checkStatsigFeatureGate_CACHED_MAY_BE_STALE(_key: string): boolean {
  return false
}

export function getFeatureValue_CACHED_WITH_REFRESH<T>(_key: string, defaultValue: T): T {
  return defaultValue
}

export function getDynamicConfig_BLOCKS_ON_INIT<T>(_key: string, defaultValue: T): T {
  return defaultValue
}

export function checkGate_CACHED_OR_BLOCKING(_key: string): boolean {
  return false
}

export function onGrowthBookRefresh(_callback: () => void): void {}

export function checkSecurityRestrictionGate(_key: string): boolean {
  return false
}
