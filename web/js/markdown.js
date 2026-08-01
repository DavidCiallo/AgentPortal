// ---------------------------------------------------------------------------
// markdown.js — Lightweight Markdown renderer + diff-line formatting.
// Depends on: utils.js  (escapeHtml)
// ---------------------------------------------------------------------------

function renderMarkdown(text) {
  // Escape HTML first, then apply markdown
  // We need to be careful: escapeHtml converts & < > " but not * `
  // so markdown syntax still works after escaping
  let html = escapeHtml(text)

  // Code blocks ```...```
  html = html.replace(/```([\s\S]*?)```/g, '<pre><code>$1</code></pre>')
  // Inline code `...`
  html = html.replace(/`([^`]+)`/g, '<code class="inline-code">$1</code>')
  // Bold **...**
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
  // Italic *...*
  html = html.replace(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g, '<em>$1</em>')
  // Newlines (but not inside pre blocks)
  html = html.replace(/\n/g, '<br>')
  return html
}

// Format tool call display with colored diff lines
function formatDiffLine(line, cssClass) {
  // line = "- 5: content" or "- content" or "+ 5: content" or "+ content"
  const prefix = line.slice(0, 2)  // "- " or "+ "
  const rest = line.slice(2)
  // Parse line number: "5: actual content" or just "actual content"
  const match = rest.match(/^(\d+):\s(.*)$/)
  if (match) {
    const lineNum = match[1]
    const text = match[2]
    return `<span class="${cssClass}"><span class="diff-prefix">${escapeHtml(prefix)}</span><span class="diff-line-num">${lineNum}</span>${escapeHtml(text)}</span>`
  }
  return `<span class="${cssClass}"><span class="diff-prefix">${escapeHtml(prefix)}</span>${escapeHtml(rest)}</span>`
}

function formatToolCallDisplay(display) {
  const displayLines = display.split('\n')
  const firstLine = displayLines[0]
  const restLines = displayLines.slice(1)

  let html = `<span class="tool-header">&#9679; ${escapeHtml(firstLine)}</span>`

  for (const line of restLines) {
    if (line.startsWith('- ')) {
      html += formatDiffLine(line, 'diff-line-minus')
    } else if (line.startsWith('+ ')) {
      html += formatDiffLine(line, 'diff-line-plus')
    } else {
      html += `<span class="diff-line-neutral">${escapeHtml(line)}</span>`
    }
  }

  return html
}
