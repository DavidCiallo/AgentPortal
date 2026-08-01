// ---------------------------------------------------------------------------
// tools.js — Tool-call rendering (live + history), merge logic, containers.
// Depends on: state.js  (currentToolContainer, currentToolList, chatContainer)
//             utils.js  (escapeHtml, scrollToBottom)
//             markdown.js (formatToolCallDisplay)
// ---------------------------------------------------------------------------

// Toggle tool calls expansion
function toggleToolCalls(button) {
  const container = button.closest('.tool-calls-container')
  if (container) {
    container.classList.toggle('expanded')
    button.classList.toggle('expanded')
  }
}

// Show Tools preference — controls default expand/collapse of new tool calls
function toggleShowTools(enabled) {
  localStorage.setItem('showTools', enabled ? '1' : '0')
}

// Merge consecutive single-line tool calls with the same tool name
function mergeToolCalls(toolCalls) {
  const groups = []
  for (const tc of toolCalls) {
    const isSingleLine = !tc.display.includes('\n')
    const last = groups[groups.length - 1]
    if (last && last.toolName === tc.toolName && isSingleLine && last.merged) {
      last.items.push(tc.display)
    } else {
      groups.push({
        toolName: tc.toolName,
        items: [tc.display],
        merged: isSingleLine
      })
    }
  }
  return groups
}

// Render a tool call with optional output and error state.
// Handles merging with previous same-named tool call (single-line only).
// Renders inside a .tool-calls-container with a toggle button (same pattern as history).
function renderToolCallLive(toolName, display, output = '', isError = false) {
  const list = getOrCreateToolList()
  const isSingleLine = !display.includes('\n')
  // Check for merge with last rendered tool call within this container
  const allDisplays = list.querySelectorAll('.tool-use-display')
  const lastDisplay = allDisplays[allDisplays.length - 1]

  if (lastDisplay && lastDisplay.dataset.toolName === toolName && isSingleLine) {
    if (lastDisplay.classList.contains('tool-merge-group')) {
      // Already a group — add item
      const header = lastDisplay.querySelector('.tool-header')
      const items = lastDisplay.querySelectorAll('.tool-merge-item')
      header.innerHTML = `${escapeHtml(toolName)} <span class="tool-merge-count">\u00d7${items.length + 1}</span>`
      const item = document.createElement('span')
      item.className = 'tool-merge-item'
      item.textContent = display
      lastDisplay.appendChild(item)
    } else {
      // Convert single to merge group
      const headerText = lastDisplay.querySelector('.tool-header')?.textContent?.replace('\u25cf ', '') || toolName
      lastDisplay.classList.add('tool-merge-group')
      lastDisplay.innerHTML = [
        `<span class="tool-header">&#9679; ${escapeHtml(toolName)} \u00d72</span>`,
        `<span class="tool-merge-item">${escapeHtml(headerText)}</span>`,
        `<span class="tool-merge-item">${escapeHtml(display)}</span>`
      ].join('')
    }
    updateToolContainerCount()
    scrollToBottom()
    return lastDisplay
  }

  // New element
  const el = document.createElement('div')
  el.className = 'tool-use-display'
  if (isError) el.classList.add('tool-error')
  el.dataset.toolName = toolName

  let html = formatToolCallDisplay(display)

  if (output) {
    const statusClass = isError ? 'tool-result-error' : 'tool-result-neutral'
    html += `<div class="tool-result-output ${statusClass}">${escapeHtml(output)}</div>`
  }

  el.innerHTML = html
  list.appendChild(el)
  updateToolContainerCount()
  scrollToBottom()
  return el
}

function getOrCreateToolList() {
  if (currentToolList) return currentToolList

  // Create container
  currentToolContainer = document.createElement('div')
  const showExpanded = localStorage.getItem('showTools') !== '0'
  currentToolContainer.className = 'tool-calls-container' + (showExpanded ? ' expanded' : '')

  const toggleBtn = document.createElement('div')
  toggleBtn.className = 'tool-calls-toggle' + (showExpanded ? ' expanded' : '')
  toggleBtn.onclick = () => toggleToolCalls(toggleBtn)
  toggleBtn.innerHTML = `
    <span class="icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="14" height="14"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76Z"/></svg></span>
    <span class="toggle-label">0 tool calls</span>
    <span class="count">0</span>
  `
  currentToolContainer.appendChild(toggleBtn)

  currentToolList = document.createElement('div')
  currentToolList.className = 'tool-calls-list'
  currentToolContainer.appendChild(currentToolList)

  chatContainer.appendChild(currentToolContainer)
  return currentToolList
}

function updateToolContainerCount() {
  if (!currentToolList) return
  const count = currentToolList.querySelectorAll('.tool-use-display').length
  const labelEl = currentToolContainer.querySelector('.toggle-label')
  const countEl = currentToolContainer.querySelector('.count')
  if (labelEl) labelEl.textContent = `${count} tool call${count !== 1 ? 's' : ''}`
  if (countEl) countEl.textContent = count
}

// Render a tool calls list from merged groups
function renderToolCallsList(toolCalls) {
  const groups = mergeToolCalls(toolCalls)
  const list = document.createElement('div')
  list.className = 'tool-calls-list'

  for (const group of groups) {
    if (!group.merged || group.items.length === 1) {
      // Single item — render as before
      const tcEl = document.createElement('div')
      tcEl.className = 'tool-use-display'
      tcEl.innerHTML = formatToolCallDisplay(group.items[0])
      list.appendChild(tcEl)
    } else {
      // Merged group — show header + individual items
      const mergeEl = document.createElement('div')
      mergeEl.className = 'tool-use-display tool-merge-group'
      let html = `<span class="tool-header">&#9679; ${escapeHtml(group.toolName)} ×${group.items.length}</span>`
      for (const item of group.items) {
        html += `<span class="tool-merge-item">${escapeHtml(item)}</span>`
      }
      mergeEl.innerHTML = html
      list.appendChild(mergeEl)
    }
  }

  return list
}
