/**
 * Barrel re-export — the AppState type lives in AppStateStore.ts.
 * The original AppState.tsx (terminal UI component) was removed during
 * CLI cleanup; this file preserves the import path for shared code.
 */
export type { AppState } from './AppStateStore.js'
