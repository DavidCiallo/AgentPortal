// Stub — cachedMicrocompact not included in source snapshot (feature-gated)
export function isCachedMicrocompactEnabled(): boolean {
  return false
}

export function isModelSupportedForCacheEditing(_model: string): boolean {
  return false
}

export function getCachedMCConfig(): { enabled: boolean; supportedModels?: string[]; systemPromptSuggestSummaries?: boolean; keepRecent?: number } {
  return { enabled: false }
}

export function createCachedMCState(): any {
  return {}
}

export function registerToolResult(_state: any, _toolUseId: string): void {}
export function registerToolMessage(_state: any, _groupIds: string[]): void {}
export function getToolResultsToDelete(_state: any): string[] { return [] }