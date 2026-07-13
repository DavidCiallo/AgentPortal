/**
 * Stub — terminal hyperlink support detection.
 * In web mode, hyperlinks are always "supported" (browser handles them).
 */
export const ADDITIONAL_HYPERLINK_TERMINALS: string[] = []

export function supportsHyperlinks(): boolean {
  return true
}

export default supportsHyperlinks
