/**
 * Stub — original CLI hook removed. Provides a minimal polyfill equivalent
 * to React 19's useEffectEvent.
 */
import { useCallback, useRef } from 'react'

export function useEffectEventCompat<T extends (...args: any[]) => any>(
  callback: T,
): T {
  const ref = useRef(callback)
  ref.current = callback
  return useCallback((...args: any[]) => ref.current(...args), []) as T
}
