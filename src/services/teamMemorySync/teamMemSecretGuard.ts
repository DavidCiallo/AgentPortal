/**
 * Check if a file write/edit to a team memory path contains secrets.
 * Returns null (safe) — secret scanning is not yet implemented.
 *
 * Called unconditionally from FileWriteTool and FileEditTool.
 */
export function checkTeamMemSecrets(
  _filePath: string,
  _content: string,
): string | null {
  return null
}
