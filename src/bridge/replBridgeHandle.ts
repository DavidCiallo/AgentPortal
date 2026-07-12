/**
 * Stub for removed REPL bridge handle module.
 */

export interface ReplBridgeHandle {
  bridgeSessionId: string
  sessionIngressUrl: string
  disconnect: () => void
  sendMessage: (message: unknown) => void
  writeMessages: (messages: unknown[]) => void
  sendResult: (result?: unknown) => void
  teardown: () => void
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
