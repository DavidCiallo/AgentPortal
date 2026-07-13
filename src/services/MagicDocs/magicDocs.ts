/**
 * Magic Docs automatically maintains markdown documentation files marked with special headers.
 * When a file with "# MAGIC DOC: [title]" is read, it runs periodically in the background
 * using a forked subagent to update the document with new learnings from the conversation.
 *
 * See docs/magic-docs.md for more information.
 */


// Magic Doc header pattern: # MAGIC DOC: [title]
// Matches at the start of the file (first line)
const MAGIC_DOC_HEADER_PATTERN = /^#\s*MAGIC\s+DOC:\s*(.+)$/im
// Pattern to match italics on the line immediately after the header
const ITALICS_PATTERN = /^[_*](.+?)[_*]\s*$/m

// Track magic docs
type MagicDocInfo = {
  path: string
}

const trackedMagicDocs = new Map<string, MagicDocInfo>()

export function clearTrackedMagicDocs(): void {
  trackedMagicDocs.clear()
}

/**
 * Detect if a file content contains a Magic Doc header
 * Returns an object with title and optional instructions, or null if not a magic doc
 */
export function detectMagicDocHeader(
  content: string,
): { title: string; instructions?: string } | null {
  const match = content.match(MAGIC_DOC_HEADER_PATTERN)
  if (!match || !match[1]) {
    return null
  }

  const title = match[1].trim()

  // Look for italics on the next line after the header (allow one optional blank line)
  const headerEndIndex = match.index! + match[0].length
  const afterHeader = content.slice(headerEndIndex)
  // Match: newline, optional blank line, then content line
  const nextLineMatch = afterHeader.match(/^\s*\n(?:\s*\n)?(.+?)(?:\n|$)/)

  if (nextLineMatch && nextLineMatch[1]) {
    const nextLine = nextLineMatch[1]
    const italicsMatch = nextLine.match(ITALICS_PATTERN)
    if (italicsMatch && italicsMatch[1]) {
      const instructions = italicsMatch[1].trim()
      return {
        title,
        instructions,
      }
    }
  }

  return { title }
}

/**
 * Register a file as a Magic Doc when it's read
 * Only registers once per file path - the hook always reads latest content
 */
export function registerMagicDoc(filePath: string): void {
  // Only register if not already tracked
  if (!trackedMagicDocs.has(filePath)) {
    trackedMagicDocs.set(filePath, {
      path: filePath,
    })
  }
}

export async function initMagicDocs(): Promise<void> {
}
