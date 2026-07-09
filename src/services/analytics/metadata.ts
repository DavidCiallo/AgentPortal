/**
 * Stub for removed analytics metadata module.
 */
export function extractToolInputForTelemetry(_toolName: string, _input: unknown): Record<string, unknown> {
  return {}
}

export function getFileExtensionForAnalytics(_filePath: string): string {
  return ''
}

export function getFileExtensionsFromBashCommand(_command: string): string[] {
  return []
}

export function isToolDetailsLoggingEnabled(): boolean {
  return false
}

export function mcpToolDetailsForAnalytics(_toolName: string, _input: unknown): Record<string, unknown> {
  return {}
}

export function sanitizeToolNameForAnalytics(toolName: string): string {
  return toolName
}

export function extractMcpToolDetails(_toolName: string): Record<string, unknown> {
  return {}
}

export function extractSkillName(_toolName: string): string | undefined {
  return undefined
}

export function AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS(): boolean {
  return false
}
