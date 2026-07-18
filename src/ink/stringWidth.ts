/**
 * Stub — terminal string width measurement.
 * In web mode, returns input.length as a rough approximation.
 */
export function stringWidth(str: string): number {
  const stripped = str.replace(/\x1B\[[0-9;]*[a-zA-Z]/g, '')
  return stripped.length
}
