/**
 * Stub for removed REPL bridge handle module.
 */

export interface ReplBridgeHandle {
  bridgeSessionId: string
  disconnect: () => void
  sendMessage: (message: unknown) => void
}

let handle: ReplBridgeHandle | null = null

export function setReplBridgeHandle(h: ReplBridgeHandle | null): void {
  handle = h
}

export function getReplBridgeHandle(): ReplBridgeHandle | null {
  return handle
}

export function getSelfBridgeCompatId(): string | undefined {
  return undefined
}
