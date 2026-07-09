/** Stub for removed swarm/backends/types.ts */

export type BackendType = 'tmux' | 'pane' | 'warp' | 'iterm2'
export type PaneBackendType = 'pane'

export function isPaneBackend(backend: BackendType): backend is PaneBackendType {
  return backend === 'pane'
}
