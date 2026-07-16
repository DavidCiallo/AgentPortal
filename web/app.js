const WS_URL = `ws://${location.host}`
let ws = null
let sessionId = ''
let currentProject = ''      // raw cwd of the active session
let currentProjectId = ''    // sanitized project dir name (matches /api/projects id)
let isGenerating = false
// The user's message text, saved when a round starts so it can be
// restored into the textarea if the user cancels mid-generation.
let pendingUserInput = ''
let currentAssistantEl = null
let pendingToolElements = new Map()  // toolUseId → rendered DOM element, for live output updates
let pendingPrompts = new Map()
let currentModel = ''  // Model name from settings
let currentToolContainer = null  // .tool-calls-container for live tool calls
let currentToolList = null       // .tool-calls-list inside the container

// Edit mode for session management (mobile friendly)
let isEditMode = false

// History pagination (infinite scroll up)
let messageOffset = 0
let totalMessages = 0
let hasMoreMessages = false
let isLoadingHistory = false

// API error retry
const MAX_RETRIES = 3
const RETRY_DELAY = 2000
let lastChatMessage = null
let retryCount = 0

const chatContainer = document.getElementById('chatContainer')
const messageInput = document.getElementById('messageInput')
const sendBtn = document.getElementById('sendBtn')
const agentStatusEl = document.getElementById('agentStatus')
const agentStatusDot = agentStatusEl?.querySelector('.agent-status-dot')
const agentStatusText = document.getElementById('agentStatusText')

// Theme management
// Disable the browser's automatic scroll-position restoration on reload.
// We manage the chat scroll ourselves (scrollToBottom after loading messages)
// and the browser's restore can race with our rAF-based scroll, leaving the
// viewport mid-conversation instead of at the latest message.
if ('scrollRestoration' in history) {
  history.scrollRestoration = 'manual'
}

function getTheme() {
  return localStorage.getItem('portal-theme') || 'light'
}

function setTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme)
  localStorage.setItem('portal-theme', theme)
  const btn = document.getElementById('themeToggle')
}

function toggleTheme() {
  const current = getTheme()
  const next = current === 'dark' ? 'light' : 'dark'
  setTheme(next)
}

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
      header.innerHTML = `&#9679; ${escapeHtml(toolName)} \u00d7${items.length + 1}`
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
    <span class="icon">&#128295;</span>
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

// Restore show-tools state (default: expanded)
const savedShowTools = localStorage.getItem('showTools') !== '0'
document.getElementById('showToolsToggle').checked = savedShowTools

// Initialize theme
setTheme(getTheme())

// Connect WebSocket
function connect() {
  ws = new WebSocket(WS_URL)

  ws.onopen = () => {
    setConnectionStatus(true)
    setSendButtonState('send')
    // Load config to populate currentModel
    ws.send(JSON.stringify({ type: 'get_config' }))
    // Restore the last session from localStorage (also subscribes if restored)
    autoRestoreLastSession()
    // If already in a session (e.g. after reconnect), resubscribe to live updates
    if (sessionId) subscribeToSession()
  }

  ws.onclose = () => {
    setConnectionStatus(false)
    sendBtn.disabled = true
    setTimeout(connect, 3000)
  }

  ws.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data)
      console.log('[ws] Received:', msg.type, msg)
      handleMessage(msg)
    } catch (e) {
      console.error('[ws] Error parsing message:', e, event.data)
    }
  }
}

function handleMessage(msg) {
  console.log('[handleMessage] Processing:', msg.type)
  try {
  // Discard events from a session we've already switched away from.
  // This prevents stale streaming events from polluting the new session's UI
  // after the user switches while a round is still in progress.
  if (msg._sessionId && sessionId && msg._sessionId !== sessionId) {
    console.log('[handleMessage] Ignoring stale event from session', msg._sessionId, '(current:', sessionId, ')')
    return
  }
  switch (msg.type) {
    case 'text_chunk':
      showAgentStatus('Generating', false)
      if (!currentAssistantEl) {
        currentAssistantEl = addMessage('', 'assistant')
      }
      currentAssistantEl.dataset.rawText = (currentAssistantEl.dataset.rawText || '') + msg.text
      // 流式渲染 markdown，每块逐步追加，兼顾逐字效果和 markdown/diff 高亮
      currentAssistantEl.innerHTML = renderMarkdown(currentAssistantEl.dataset.rawText)
      // Reset tool container so the next tool_use_display starts a fresh
      // group. Without this, tool A → text → tool A would merge the two
      // tool A calls into a single group even though text separated them.
      currentToolContainer = null
      currentToolList = null
      scrollToBottom()
      break

    case 'tool_start':
      showAgentStatus('Running tools', false)
      break

    case 'tool_use_display':
      // Finalize current text bubble — next text_chunk starts a new message
      currentAssistantEl = null
      // Render immediately so user sees the tool running (real-time feedback)
      if (msg.toolName !== 'Read') {
        const el = renderToolCallLive(msg.toolName, msg.display)
        if (msg.toolUseId && el) {
          pendingToolElements.set(msg.toolUseId, el)
        }
      }
      break

    case 'tool_result':
      // Match by toolUseId and append output to the already-rendered element
      if (msg.toolUseId && pendingToolElements.has(msg.toolUseId)) {
        const el = pendingToolElements.get(msg.toolUseId)
        pendingToolElements.delete(msg.toolUseId)
        if (msg.output) {
          const statusClass = msg.isError ? 'tool-result-error' : 'tool-result-neutral'
          const outDiv = document.createElement('div')
          outDiv.className = `tool-result-output ${statusClass}`
          outDiv.textContent = msg.output
          el.appendChild(outDiv)
          if (msg.isError) el.classList.add('tool-error')
          scrollToBottom()
        }
      }
      break

    case 'done':
      sessionId = msg.sessionId || sessionId
      // Save session ID for auto-restore on page reload
      if (sessionId) {
        localStorage.setItem('lastSessionId', sessionId)
        if (currentProject) {
          localStorage.setItem('lastProjectDir', currentProject)
        }
        // Also save in the same format switchSession() uses. Prefer the
        // server-provided sanitized project id (currentProjectId, set from
        // session_started) over re-deriving it client-side — the server's
        // sanitizePath handles characters the simple regex would miss.
        const projectDir = currentProjectId
          || (currentProject ? currentProject.replace(/[/\\:]/g, '-') : 'unknown')
        localStorage.setItem('lastSession', JSON.stringify({
          projectId: projectDir,
          sessionId,
          cwd: currentProject || '',
        }))

        // Refresh the sidebar so a brand-new conversation appears in the
        // list immediately. The session entry only becomes visible once
        // its JSONL has a summary/last-prompt record, which is written
        // during the round we just finished — so reload now, then mark
        // the active row. Skip the network round-trip if the project
        // container isn't mounted (sidebar never opened).
        if (currentProjectId && document.getElementById(`sessions-${currentProjectId}`)) {
          loadSessions(currentProjectId).then(() => {
            document.querySelectorAll('.session-item').forEach(el => el.classList.remove('active'))
            document.querySelector(`.session-item[data-session-id="${sessionId}"]`)?.classList.add('active')
          })
        }
      }
      // Flush any remaining buffered tool elements (never got results)
      pendingToolElements.clear()
      // Reset container for next response
      currentToolContainer = null
      currentToolList = null
      // Final render with markdown now that streaming is complete
      if (currentAssistantEl && currentAssistantEl.dataset.rawText) {
        currentAssistantEl.innerHTML = renderMarkdown(currentAssistantEl.dataset.rawText)
      }

      // Remove empty assistant message bubble
      if (currentAssistantEl && !currentAssistantEl.textContent.trim()) {
        currentAssistantEl.remove()
      }
      currentAssistantEl = null
      setSendButtonState('send')
      pendingUserInput = ''
      messageInput.focus()

      hideAgentStatus()
      break

    case 'cancelled':
      // Flush any remaining buffered tool elements
      pendingToolElements.clear()
      if (currentAssistantEl && !currentAssistantEl.textContent.trim()) {
        currentAssistantEl.remove()
      }
      currentAssistantEl = null
      currentToolContainer = null
      currentToolList = null
      setSendButtonState('send')

      hideAgentStatus()
      addMessage('Generation cancelled.', 'assistant')
      break

    case 'error':
      if (isGenerating && retryCount < MAX_RETRIES) {
        retryCount++
        console.log(`[retry] Attempt ${retryCount}/${MAX_RETRIES} after error: ${msg.message}`)
        setTimeout(() => {
          if (ws && ws.readyState === WebSocket.OPEN && lastChatMessage) {
            ws.send(JSON.stringify(lastChatMessage))
          }
        }, RETRY_DELAY)
        return  // Don't show error yet
      }
      addMessage(`Error: ${msg.message}`, 'error')
      setSendButtonState('send')
      pendingUserInput = ''

      hideAgentStatus()
      break

    case 'session_started':
      // Server has allocated/confirmed the sessionId for this round. Pin it
      // immediately so subsequent UI state (retry, subscribe, etc.) targets
      // the right session instead of waiting for `done`.
      sessionId = msg.sessionId || sessionId
      if (msg.cwd) currentProject = msg.cwd
      if (msg.projectId) currentProjectId = msg.projectId
      break

    case 'config':
      loadConfig(msg)
      break

    case 'config_validating':
      showConfigStatus('validating', 'Validating connection...')
      document.querySelector('.btn-save').disabled = true
      break

    case 'config_saved':
      showConfigStatus('success', 'Settings saved! Reconnecting...')
      document.querySelector('.btn-save').disabled = false
      // Reconnect to apply new settings
      setTimeout(() => {
        if (ws) ws.close()
        connect()
      }, 1000)
      break

    case 'config_error':
      showConfigStatus('error', msg.message || 'Validation failed')
      document.querySelector('.btn-save').disabled = false
      break

    case 'subscribed':
      // Server confirmed subscription. If a round is running, show agent status
      // so the UI reflects the in-progress execution that was replayed.
      if (msg.running) {
        setSendButtonState('stop')
        // Use server-provided round start time so late joiners see the true elapsed time
        showAgentStatus('Working', true, msg.roundStartTime)
      }
      break
  }
  } catch (e) {
    console.error('[handleMessage] Error:', e, msg)
  }
}

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

function addMessage(text, className) {
  const el = document.createElement('div')
  el.className = `message ${className}`
  el.dataset.rawText = text
  // Only render markdown for assistant messages
  if (className === 'assistant') {
    el.innerHTML = renderMarkdown(text)
  } else {
    el.textContent = text
  }
  chatContainer.appendChild(el)
  scrollToBottom()
  return el
}

// Agent working status — persistent indicator at bottom-bar
let agentStatusStart = 0
let agentStatusInterval = null
let _connected = false

function setConnectionStatus(connected) {
  _connected = connected
  if (!agentStatusEl || !agentStatusDot || !agentStatusText) return
  agentStatusEl.classList.remove('visible', 'connected', 'disconnected')
  agentStatusEl.classList.toggle('connected', connected)
  agentStatusEl.classList.toggle('disconnected', !connected)
  agentStatusText.textContent = connected ? 'Connected' : 'Disconnected'
}

function showAgentStatus(text, resetTimer = true, startTime) {
  if (!agentStatusEl || !agentStatusDot || !agentStatusText) return
  agentStatusEl.classList.remove('connected', 'disconnected')
  agentStatusEl.classList.add('visible')
  if (resetTimer) agentStatusStart = startTime || Date.now()
  agentStatusText.textContent = text || 'Working'
  if (agentStatusInterval) clearInterval(agentStatusInterval)
  agentStatusInterval = setInterval(() => {
    const elapsed = Math.max(0, Math.floor((Date.now() - agentStatusStart) / 1000))
    const m = Math.floor(elapsed / 60)
    const s = elapsed % 60
    agentStatusText.textContent = `${text || 'Working'} (${m}m ${s}s)`
  }, 1000)
}

function hideAgentStatus() {
  if (!agentStatusEl || !agentStatusDot || !agentStatusText) return
  agentStatusEl.classList.remove('visible')
  if (agentStatusInterval) {
    clearInterval(agentStatusInterval)
    agentStatusInterval = null
  }
  // Revert to connection status
  setConnectionStatus(_connected)
}

/**
 * Toggle the Send button between its two roles:
 *  - 'send': shows "Send", disabled when the textarea is empty, enabled otherwise.
 *  - 'stop': shows "Stop", always enabled — clicks cancel the running round.
 *
 * The button is reused (rather than adding a second element) to keep the input
 * area compact, especially on mobile.
 */
function setSendButtonState(state) {
  if (state === 'stop') {
    isGenerating = true
    sendBtn.textContent = 'Stop'
    sendBtn.classList.add('stop')
    sendBtn.disabled = false
  } else {
    isGenerating = false
    sendBtn.textContent = 'Send'
    sendBtn.classList.remove('stop')
    // Send is disabled when there's no text to send.
    sendBtn.disabled = messageInput.value.trim() === ''
  }
}

function isNearBottom() {
  // Consider user "near bottom" if within 1 viewport height from the bottom
  return chatContainer.scrollTop + chatContainer.clientHeight >= chatContainer.scrollHeight - chatContainer.clientHeight
}

function scrollToBottom(force = false) {
  // Defer to next frame so layout (scrollHeight) is settled after
  // large innerHTML rewrites. Setting scrollTop synchronously can
  // land short when the browser hasn't computed the new layout yet,
  // causing a visible flicker/jump.
  // The isNearBottom check is inside rAF because scrollHeight may
  // change between the call and the frame (new content inserted by
  // streaming or tool rendering). Reading it at the last moment
  // ensures we compare against the final layout height.
  requestAnimationFrame(() => {
    if (!force && !isNearBottom()) return
    chatContainer.scrollTop = chatContainer.scrollHeight
  })
}


function escapeHtml(text) {
  const div = document.createElement('div')
  div.textContent = text
  return div.innerHTML
}

// Settings functions
function openSettings() {
  document.getElementById('settingsModal').classList.add('active')
  // Request current config from server
  ws.send(JSON.stringify({ type: 'get_config' }))
}

function closeSettings() {
  document.getElementById('settingsModal').classList.remove('active')
  document.getElementById('configStatus').className = 'config-status'
  document.getElementById('configStatus').textContent = ''
}

function loadConfig(config) {
  document.getElementById('providerSelect').value = 'openai'
  document.getElementById('baseUrlInput').value = config.baseUrl || ''
  document.getElementById('apiKeyInput').value = config.hasApiKey ? '••••••••' : ''
  document.getElementById('apiKeyInput').placeholder = config.hasApiKey ? '••••••••' : 'sk-...'
  document.getElementById('languageSelect').value = config.language || 'chinese'
  currentModel = config.model || ''

  // Set the project directory from the server's cwd so new sessions are
  // created in the correct project folder (not the server process cwd).
  if (config.cwd && !currentProject) {
    currentProject = config.cwd
    currentProjectId = currentProject.replace(/[/\\:]/g, '-')
  }

  // Fetch available models from the API and populate the dropdown
  fetchModelsAndPopulateSelect(config.model)
}

async function refreshModels() {
  const baseUrl = document.getElementById('baseUrlInput').value
  if (baseUrl) {
    // Override env config to use the URL the user typed
    await fetchModelsAndPopulateSelect(document.getElementById('modelSelect').value, baseUrl)
  } else {
    await fetchModelsAndPopulateSelect(document.getElementById('modelSelect').value)
  }
}

async function fetchModelsAndPopulateSelect(currentModelValue, baseUrlOverride) {
  const modelSelect = document.getElementById('modelSelect')
  // Show loading state
  modelSelect.innerHTML = '<option value="">Loading models...</option>'
  modelSelect.disabled = true

  try {
    let url = '/api/models'
    if (baseUrlOverride) {
      url += '?' + new URLSearchParams({ baseUrl: baseUrlOverride })
    }
    const response = await fetch(url)
    const data = await response.json()

    modelSelect.innerHTML = ''

    if (data.models && data.models.length > 0) {
      // Sort models alphabetically
      const sorted = [...data.models].sort()
      for (const modelId of sorted) {
        const opt = document.createElement('option')
        opt.value = modelId
        opt.textContent = modelId
        modelSelect.appendChild(opt)
      }
    } else {
      // Fallback: no models returned
      const opt = document.createElement('option')
      opt.value = ''
      opt.textContent = 'No models available'
      modelSelect.appendChild(opt)
    }

    // Select current model if it exists in the list
    if (currentModelValue && [...modelSelect.options].some(o => o.value === currentModelValue)) {
      modelSelect.value = currentModelValue
    } else if (currentModelValue) {
      // Add as custom option if not in list
      const opt = document.createElement('option')
      opt.value = currentModelValue
      opt.textContent = currentModelValue
      modelSelect.appendChild(opt)
      modelSelect.value = currentModelValue
    }
  } catch (err) {
    console.error('Failed to fetch models:', err)
    // Fallback to common models on error
    modelSelect.innerHTML = ''
    const fallbacks = ['gpt-4o', 'gpt-4o-mini', 'deepseek-chat', 'deepseek-reasoner']
    for (const id of fallbacks) {
      const opt = document.createElement('option')
      opt.value = id
      opt.textContent = id
      modelSelect.appendChild(opt)
    }
    if (currentModelValue) {
      modelSelect.value = currentModelValue
    }
  } finally {
    modelSelect.disabled = false
  }
}

function saveSettings() {
  const config = {
    type: 'save_config',
    profile: 'openai',
    baseUrl: document.getElementById('baseUrlInput').value,
    model: document.getElementById('modelSelect').value,
    apiKey: document.getElementById('apiKeyInput').value,
    language: document.getElementById('languageSelect').value || undefined,
  }
  ws.send(JSON.stringify(config))
}

function showConfigStatus(type, message) {
  const statusEl = document.getElementById('configStatus')
  if (type === 'validating') {
    statusEl.className = 'config-status validating'
    statusEl.style.display = 'block'
    statusEl.style.background = 'rgba(59, 130, 246, 0.15)'
    statusEl.style.borderColor = 'var(--accent)'
    statusEl.style.color = 'var(--accent)'
  } else if (type === 'success') {
    statusEl.className = 'config-status success'
    setTimeout(() => {
      closeSettings()
    }, 1500)
  } else {
    statusEl.className = 'config-status error'
  }
  statusEl.textContent = message
}

async function sendMessage() {
  const message = messageInput.value.trim()
  if (!message || isGenerating) return

  // If continuing an existing session, load and display full history
  // so the user sees the complete conversation context.
  if (sessionId) {
    const projectDir = currentProject
      ? currentProject.replace(/[/\\:]/g, '-')
      : 'unknown'
    messageOffset = 0
    totalMessages = 0
    hasMoreMessages = false
    try {
      const resp = await fetch(`/api/session-messages?project=${encodeURIComponent(projectDir)}&session=${encodeURIComponent(sessionId)}&offset=0&limit=40`)
      const data = await resp.json()
      if (data.messages && data.messages.length > 0) {
        chatContainer.innerHTML = ''
        renderSessionMessages(data.messages)
        messageOffset = data.messages.length
        totalMessages = data.total
        hasMoreMessages = data.hasMore
        scrollToBottom(true)
      }
    } catch {
      // Failed to load history — proceed with empty chat
    }
  }

  addMessage(message, 'user')
  scrollToBottom(true)
  // Remember what the user sent so we can put it back into the textarea
  // if they cancel the round before it completes.
  pendingUserInput = message
  messageInput.value = ''
  messageInput.style.height = 'auto'

  setSendButtonState('stop')
  showAgentStatus('Working')

  const chatMsg = {
    type: 'chat',
    message,
    sessionId,
    cwd: currentProject || undefined,
    model: currentModel || undefined,
  }
  console.log('[sendMessage] Sending:', chatMsg)
  lastChatMessage = chatMsg
  retryCount = 0
  ws.send(JSON.stringify(chatMsg))
}

// Event listeners
sendBtn.addEventListener('click', () => {
  if (isGenerating) {
    // Cancel the running round and restore the user's input so they can edit
    // and resend without retyping.
    ws.send(JSON.stringify({ type: 'cancel', sessionId }))
    if (pendingUserInput) {
      messageInput.value = pendingUserInput
      messageInput.style.height = 'auto'
      messageInput.style.height = Math.min(messageInput.scrollHeight, 120) + 'px'
    }
    return
  }
  sendMessage()
})

// Infinite scroll — load older messages when within ~1 viewport height from top
// Guard flag: set true during initial session restore so the browser's
// scroll-position restoration doesn't fire spurious loadMoreMessages().
let suppressScrollLoad = false
let scrollLoadTimer = null
chatContainer.addEventListener('scroll', () => {
  if (suppressScrollLoad) return
  if (scrollLoadTimer) clearTimeout(scrollLoadTimer)
  scrollLoadTimer = setTimeout(() => {
    if (suppressScrollLoad) return
    if (chatContainer.scrollTop < chatContainer.clientHeight && hasMoreMessages && !isLoadingHistory) {
      loadMoreMessages()
    }
  }, 200)
})

messageInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault()
    sendMessage()
  }
})

messageInput.addEventListener('input', () => {
  messageInput.style.height = 'auto'
  messageInput.style.height = Math.min(messageInput.scrollHeight, 120) + 'px'
  // Keep the Send button's disabled state in sync with the textarea contents.
  // (Only when in 'send' mode — Stop is always enabled.)
  if (!isGenerating) {
    sendBtn.disabled = messageInput.value.trim() === ''
  }
})

// Android Chrome keyboard: scroll chat to bottom when input gets focus
messageInput.addEventListener('focus', () => {
  setTimeout(() => {
    chatContainer.scrollTop = chatContainer.scrollHeight
  }, 300)
})

// Close modal when clicking outside
document.getElementById('settingsModal').addEventListener('click', (e) => {
  if (e.target === document.getElementById('settingsModal')) {
    closeSettings()
  }
})

// Close modal when clicking outside

// Project list management

async function loadProjects() {
  try {
    const response = await fetch('/api/projects')
    const projects = await response.json()

    const projectList = document.getElementById('projectList')
    projectList.innerHTML = ''

    projects.forEach(project => {
      const group = document.createElement('div')
      group.className = 'project-group'
      group.dataset.projectId = project.id

      const header = document.createElement('div')
      header.className = 'project-header'
      header.innerHTML = `
        <span class="project-name" title="${escapeHtml(project.name)}">${escapeHtml(project.name)}</span>
        <span class="project-count">${project.sessionCount}</span>
      `

      const sessionList = document.createElement('div')
      sessionList.className = 'session-list'
      sessionList.id = `sessions-${project.id}`

      group.appendChild(header)
      group.appendChild(sessionList)
      projectList.appendChild(group)

      // Always load sessions
      loadSessions(project.id)
    })
  } catch (err) {
    console.error('Failed to load projects:', err)
  }
}

function toggleEditMode() {
  isEditMode = !isEditMode
  const editBtn = document.getElementById('editBtn')
  const sidebar = document.querySelector('.sidebar')

  if (isEditMode) {
    editBtn.textContent = 'Done'
    editBtn.classList.add('active')
    sidebar.classList.add('edit-mode')
  } else {
    editBtn.textContent = 'Edit'
    editBtn.classList.remove('active')
    sidebar.classList.remove('edit-mode')
  }
}

async function loadSessions(projectId) {
  try {
    const response = await fetch(`/api/sessions?project=${encodeURIComponent(projectId)}`)
    const sessions = await response.json()

    const sessionList = document.getElementById(`sessions-${projectId}`)
    sessionList.innerHTML = ''

    sessions.forEach(session => {
      const item = document.createElement('div')
      item.className = `session-item ${sessionId === session.sessionId ? 'active' : ''}`
      item.dataset.sessionId = session.sessionId
      item.dataset.cwd = session.cwd || ''
      item.onclick = () => switchSession(projectId, session.sessionId, session.cwd || '')

      const title = session.customTitle || session.summary || session.firstPrompt || 'Untitled'
      const time = new Date(session.lastModified).toLocaleString()

      item.innerHTML = `
        <div class="session-content">
          <div class="session-title">${escapeHtml(title.substring(0, 50))}</div>
          <div class="session-time">${time}</div>
        </div>
        <button class="session-delete-btn" onclick="event.stopPropagation(); deleteSession('${escapeHtml(projectId)}', '${escapeHtml(session.sessionId)}')" title="Delete session">×</button>
      `

      sessionList.appendChild(item)
    })
  } catch (err) {
    console.error('Failed to load sessions:', err)
  }
}

async function deleteSession(projectId, sessionIdToDelete) {
  try {
    // Don't allow deleting the current active session
    if (sessionIdToDelete === sessionId) {
      alert('Cannot delete the currently active session')
      return
    }

    // Confirm deletion
    if (!confirm('Are you sure you want to delete this session?')) {
      return
    }

    const response = await fetch(`/api/session?project=${encodeURIComponent(projectId)}&session=${encodeURIComponent(sessionIdToDelete)}`, {
      method: 'DELETE'
    })

    if (!response.ok) {
      const error = await response.json()
      alert(error.error || 'Failed to delete session')
      return
    }

    // Reload sessions
    loadSessions(projectId)
  } catch (err) {
    console.error('Failed to delete session:', err)
    alert('Failed to delete session')
  }
}

// Render a single message's DOM elements into the given container
function renderMessage(msg, container) {
  if (msg.role === 'user') {
    const el = document.createElement('div')
    el.className = 'message user'
    el.dataset.rawText = msg.content
    el.textContent = msg.content
    container.appendChild(el)
  } else if (msg.role === 'assistant') {
    let el = null
    if (msg.content && msg.content.trim()) {
      el = document.createElement('div')
      el.className = 'message assistant'
      el.dataset.rawText = msg.content
      el.innerHTML = renderMarkdown(msg.content)
      container.appendChild(el)
    }
    if (msg.toolCalls && msg.toolCalls.length > 0) {
      // Filter out Read tool calls from history display
      const filteredCalls = msg.toolCalls.filter(tc => tc.toolName !== 'Read')
      if (filteredCalls.length === 0) return

      const toolCallsContainer = document.createElement('div')
      toolCallsContainer.className = 'tool-calls-container'

      const mergedGroups = mergeToolCalls(filteredCalls)
      const toggleBtn = document.createElement('div')
      toggleBtn.className = 'tool-calls-toggle'
      toggleBtn.onclick = () => toggleToolCalls(toggleBtn)
      const label = mergedGroups.length < filteredCalls.length
        ? `${mergedGroups.length} tool calls (merged from ${filteredCalls.length})`
        : `${filteredCalls.length} tool calls`
      toggleBtn.innerHTML = `
        <span class="icon">&#128295;</span>
        <span>${label}</span>
        <span class="count">${mergedGroups.length}</span>
      `
      toolCallsContainer.appendChild(toggleBtn)

      const toolCallsList = renderToolCallsList(filteredCalls)
      toolCallsContainer.appendChild(toolCallsList)

      if (el) {
        el.after(toolCallsContainer)
      } else {
        container.appendChild(toolCallsContainer)
      }
    }
  }
}

function renderSessionMessages(messages) {
  if (!messages || messages.length === 0) {
    addMessage('No messages in this session. Start typing to continue...', 'assistant')
    return
  }

  // First pass: merge consecutive tool-calls-only assistant messages
  const mergedMessages = []
  for (const msg of messages) {
    if (msg.role === 'user') {
      mergedMessages.push(msg)
    } else if (msg.role === 'assistant') {
      const last = mergedMessages[mergedMessages.length - 1]
      if (last && last.role === 'assistant' && !last.content?.trim() && last.toolCalls?.length > 0
          && !msg.content?.trim() && msg.toolCalls?.length > 0) {
        last.toolCalls.push(...msg.toolCalls)
      } else {
        mergedMessages.push(msg)
      }
    }
  }

  mergedMessages.forEach(msg => renderMessage(msg, chatContainer))
}

// Load older messages when scrolling to top
async function loadMoreMessages() {
  if (isLoadingHistory || !hasMoreMessages || !sessionId) return
  isLoadingHistory = true

  const projectDir = currentProject
    ? currentProject.replace(/[/\\:]/g, '-')
    : 'unknown'

  try {
    const resp = await fetch(`/api/session-messages?project=${encodeURIComponent(projectDir)}&session=${encodeURIComponent(sessionId)}&offset=${messageOffset}&limit=40`)
    const data = await resp.json()

    if (!data.messages || data.messages.length === 0) {
      hasMoreMessages = false
      return
    }

    // Force layout read to capture current scroll height before DOM changes
    const prevScrollHeight = chatContainer.scrollHeight

    // Render messages into a fragment, then prepend in correct order
    const fragment = document.createDocumentFragment()
    data.messages.forEach(msg => renderMessage(msg, fragment))
    chatContainer.insertBefore(fragment, chatContainer.firstChild)

    // Wait for browser to lay out the new content, then lock scroll position
    requestAnimationFrame(() => {
      chatContainer.scrollTop = chatContainer.scrollHeight - prevScrollHeight
    })

    messageOffset += data.messages.length
    totalMessages = data.total
    hasMoreMessages = data.hasMore
  } catch (err) {
    console.error('Failed to load more messages:', err)
  } finally {
    isLoadingHistory = false
  }
}

async function switchSession(projectId, newSessionId, cwd) {
  closeSidebar()

  // Cancel any in-flight round in the old session before switching
  if (isGenerating && sessionId) {
    ws.send(JSON.stringify({ type: 'cancel', sessionId }))
  }

  // Clear current chat
  chatContainer.innerHTML = ''
  sessionId = newSessionId
  currentProject = cwd || projectId
  currentProjectId = projectId

  // Reset agent status from the previous session — whether it was running
  // has nothing to do with the session we're switching to. The new session's
  // subscribe response will tell us if it's running.
  hideAgentStatus()
  setSendButtonState('send')
  pendingUserInput = ''
  currentAssistantEl = null
  currentToolContainer = null
  currentToolList = null
  pendingToolElements.clear()

  // Remember last session
  localStorage.setItem('lastSession', JSON.stringify({ projectId, sessionId: newSessionId, cwd: cwd || '' }))

  // Update active state
  document.querySelectorAll('.session-item').forEach(el => el.classList.remove('active'))
  document.querySelector(`.session-item[data-session-id="${newSessionId}"]`)?.classList.add('active')

  // Load session history
  messageOffset = 0
  totalMessages = 0
  hasMoreMessages = false
  try {
    const response = await fetch(`/api/session-messages?project=${encodeURIComponent(projectId)}&session=${encodeURIComponent(newSessionId)}&offset=0&limit=40`)
    const data = await response.json()
    renderSessionMessages(data.messages)
    messageOffset = data.messages.length
    totalMessages = data.total
    hasMoreMessages = data.hasMore
  } catch (err) {
    console.error('Failed to load session messages:', err)
    addMessage('Failed to load session history. Start typing to continue...', 'assistant')
  }

  // Subscribe to live updates for this session (catches in-progress rounds)
  subscribeToSession()

  scrollToBottom(true)
}

// Tell the server we want to subscribe to this session's live event stream.
// If an agent round is already running, the server will replay buffered events
// so this client sees the in-progress execution.
function subscribeToSession() {
  if (!sessionId) return
  if (!ws || ws.readyState !== WebSocket.OPEN) return
  ws.send(JSON.stringify({
    type: 'subscribe',
    sessionId,
    cwd: currentProject || undefined,
    model: currentModel || undefined,
  }))
}

// Auto-restore last session on page load
function autoRestoreLastSession() {
  try {
    const saved = localStorage.getItem('lastSession')
    if (!saved) return

    const { projectId, sessionId: savedSessionId, cwd } = JSON.parse(saved)
    if (!savedSessionId) return

    // Don't restore if already in a session
    if (sessionId) return

    // Don't restore if chat is not empty (has more than just welcome message)
    const existingMessages = chatContainer.querySelectorAll('.message')
    if (existingMessages.length > 1) return

    sessionId = savedSessionId
    currentProject = cwd || projectId
    currentProjectId = projectId

    // Suppress infinite-scroll handler while restoring — the browser may
    // fire a scroll event from its saved position before we've rendered,
    // which would spuriously trigger loadMoreMessages() and push the
    // viewport away from the bottom.
    suppressScrollLoad = true

    // Fetch and display session messages via HTTP
    fetch(`/api/session-messages?project=${encodeURIComponent(projectId)}&session=${encodeURIComponent(savedSessionId)}&offset=0&limit=40`)
      .then(res => res.json())
      .then(data => {
        if (data.messages && data.messages.length > 0) {
          // Remove welcome message before restoring
          const welcome = chatContainer.querySelector('.message.assistant:only-child')
          if (welcome && welcome.textContent.includes('Welcome to Portal')) {
            welcome.remove()
          }
          renderSessionMessages(data.messages)
          messageOffset = data.messages.length
          totalMessages = data.total
          hasMoreMessages = data.hasMore

          // Keep pinned to the bottom while content settles — images,
          // fonts, and late layout shifts can increase scrollHeight after
          // the initial paint.
          scrollToBottom(true)
          const followBottom = new MutationObserver(() => scrollToBottom(true))
          followBottom.observe(chatContainer, { childList: true, subtree: true })
          setTimeout(() => followBottom.disconnect(), 3000)

          // Subscribe to live updates (catches in-progress rounds)
          subscribeToSession()
        }
      })
      .catch(err => console.error('[autoRestore] Failed to load session:', err))
      .finally(() => {
        // Re-enable after the scrollToBottom requestAnimationFrame fires
        requestAnimationFrame(() => { suppressScrollLoad = false })
      })
  } catch (err) {
    console.error('[autoRestore] Error:', err)
  }
}

// Project Selector
let selectedProjectPath = ''

async function openProjectSelector() {
  closeSidebar()
  document.getElementById('projectModal').classList.add('active')
  selectedProjectPath = ''
  document.getElementById('customPath').value = ''

  // Load recent projects
  await loadProjectOptions()
}

function closeProjectSelector() {
  document.getElementById('projectModal').classList.remove('active')
}

async function loadProjectOptions() {
  const container = document.getElementById('projectOptions')
  container.innerHTML = ''

  try {
    const response = await fetch('/api/projects')
    const projects = await response.json()

    projects.filter(p => p.sessionCount > 0).forEach(project => {
      const option = document.createElement('div')
      option.className = 'project-option'
      option.dataset.path = project.path
      option.onclick = () => selectProject(project.path, option)

      option.innerHTML = `
        <div class="project-option-name">${escapeHtml(project.path.split(/[/\\]/).pop() || project.path)}</div>
        <div class="project-option-path">${escapeHtml(project.path)}</div>
      `

      container.appendChild(option)
    })
  } catch (err) {
    console.error('Failed to load projects:', err)
  }
}

function selectProject(path, element) {
  // Remove selected class from all options
  document.querySelectorAll('.project-option').forEach(el => el.classList.remove('selected'))

  // Add selected class to clicked option
  element.classList.add('selected')
  selectedProjectPath = path

  // Update custom path input
  document.getElementById('customPath').value = path
}

function browseFolder() {
  const browser = document.getElementById('dirBrowser')
  const wasHidden = browser.style.display === 'none'
  if (wasHidden) {
    browser.style.display = 'block'
    loadDirectory('')
  }
}

function toggleDirBrowser() {
  const browser = document.getElementById('dirBrowser')
  browser.style.display = browser.style.display === 'none' ? 'block' : 'none'
}

async function loadDirectory(dirPath) {
  const list = document.getElementById('dirBrowserList')
  const pathEl = document.getElementById('dirBrowserPath')
  hideCreateFolderInput()
  list.innerHTML = '<div class="dir-loading">Loading...</div>'

  try {
    const response = await fetch(`/api/browse-directory?path=${encodeURIComponent(dirPath)}`)
    const data = await response.json()

    if (data.error) {
      list.innerHTML = `<div class="dir-error">${escapeHtml(data.error)}</div>`
      return
    }

    pathEl.textContent = data.currentPath
    // Keep the custom path input in sync with the directory the user has
    // navigated to. Otherwise "Start Chat" would use a stale/empty path even
    // though the browser shows the intended folder.
    document.getElementById('customPath').value = data.currentPath
    selectedProjectPath = data.currentPath

    list.innerHTML = ''

    // Parent directory (..)
    if (data.parentPath) {
      const parent = document.createElement('div')
      parent.className = 'dir-entry dir-up'
      parent.innerHTML = '<span class="dir-icon">📂</span> ..'
      parent.onclick = () => loadDirectory(data.parentPath)
      list.appendChild(parent)
    }

    data.entries.forEach(entry => {
      const el = document.createElement('div')
      el.className = 'dir-entry'
      if (!entry.accessible) el.classList.add('dir-inaccessible')
      el.innerHTML = `<span class="dir-icon">📁</span> ${escapeHtml(entry.name)}`
      el.onclick = () => {
        if (entry.accessible) {
          loadDirectory(entry.path)
        }
      }
      el.ondblclick = (e) => {
        e.stopPropagation()
        document.getElementById('customPath').value = entry.path
        toggleDirBrowser()
      }
      list.appendChild(el)
    })
  } catch (err) {
    list.innerHTML = `<div class="dir-error">Failed to load: ${escapeHtml(err.message)}</div>`
  }
}

function showCreateFolderInput() {
  document.getElementById('dirBrowserNewFolder').style.display = 'flex'
  document.getElementById('newFolderInput').value = ''
  document.getElementById('newFolderInput').focus()
}

function hideCreateFolderInput() {
  document.getElementById('dirBrowserNewFolder').style.display = 'none'
}

async function createFolder() {
  const input = document.getElementById('newFolderInput')
  const folderName = input.value.trim()
  if (!folderName) return

  const pathEl = document.getElementById('dirBrowserPath')
  const parentPath = pathEl.textContent
  const fullPath = parentPath + (parentPath.endsWith('/') || parentPath.endsWith('\\') ? '' : '/') + folderName

  try {
    const response = await fetch('/api/create-directory', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: fullPath }),
    })
    const data = await response.json()

    if (data.error) {
      alert(data.error)
      return
    }

    hideCreateFolderInput()
    loadDirectory(parentPath)
  } catch (err) {
    alert(`Failed to create folder: ${err.message}`)
  }
}

async function createNewChat() {
  const customPath = document.getElementById('customPath').value.trim()
  const projectPath = customPath || selectedProjectPath

  if (!projectPath) {
    alert('Please select a project or enter a folder path')
    return
  }

  // Close modal
  closeProjectSelector()

  // Set the project
  currentProject = projectPath
  currentProjectId = projectPath.replace(/[/\\:]/g, '-')
  sessionId = ''

  // Clear chat and show welcome message
  chatContainer.innerHTML = ''
  addMessage(`Project: ${projectPath}\n\nWhat would you like to work on?`, 'assistant')

  // Remove active state from all sessions
  document.querySelectorAll('.session-item').forEach(el => el.classList.remove('active'))

  // Reload projects to show the new one
  await loadProjects()

  messageInput.focus()
}

// Mobile sidebar toggle
function toggleSidebar() {
  const sidebar = document.querySelector('.sidebar')
  const overlay = document.getElementById('sidebarOverlay')
  if (!sidebar || !overlay) return
  const isOpen = sidebar.classList.toggle('open')
  overlay.classList.toggle('active', isOpen)
  document.body.classList.toggle('sidebar-open', isOpen)
}

function closeSidebar() {
  const sidebar = document.querySelector('.sidebar')
  const overlay = document.getElementById('sidebarOverlay')
  if (!sidebar || !overlay) return
  sidebar.classList.remove('open')
  overlay.classList.remove('active')
  document.body.classList.remove('sidebar-open')
}

// Auto-show sidebar when resizing above mobile breakpoint
let resizeTimer
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer)
  resizeTimer = setTimeout(() => {
    if (window.innerWidth > 768) {
      document.querySelector('.sidebar')?.classList.remove('open')
      document.getElementById('sidebarOverlay')?.classList.remove('active')
      document.body.classList.remove('sidebar-open')
    }
  }, 150)
})

// VisualViewport handler — keeps body height synced on both mobile and desktop.
// On mobile: position:fixed prevents iOS scrolling (no more blank space), but body
// must shrink when the keyboard opens so the header stays visible. No scrollTo needed.
// On desktop: adjusts for window chrome resize.
function syncBodyHeight() {
  if (!window.visualViewport) return
  document.body.style.height = window.visualViewport.height + 'px'
}

if (window.visualViewport) {
  window.visualViewport.addEventListener('resize', () => {
    syncBodyHeight()
    if (window.innerWidth > 768) {
      window.scrollTo(0, 0)
    }
    // Android Chrome keyboard: scroll chat to bottom when viewport shrinks
    if (window.innerWidth <= 768) {
      requestAnimationFrame(() => {
        chatContainer.scrollTop = chatContainer.scrollHeight
      })
    }
  })
}

// MutationObserver: re-sync after DOM attribute changes (e.g. theme toggle).
// Toggling data-theme triggers CSS variable re-evaluation + reflow, which can
// corrupt fixed element positioning on iOS — especially when the keyboard is
// already open. rAF lets the browser settle before re-applying the height.
const viewportObserver = new MutationObserver(() => {
  requestAnimationFrame(syncBodyHeight)
})
viewportObserver.observe(document.documentElement, { attributes: true })

// Start
connect()
loadProjects().then(() => {
  // Don't auto-restore last session — start fresh to avoid
  // dumping all previous messages into a new conversation.
  // Users can manually switch to a session from the sidebar.
})
messageInput.focus()
