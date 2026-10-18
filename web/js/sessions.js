// ---------------------------------------------------------------------------
// sessions.js — Chat send/cancel, session history loading, infinite scroll.
// Depends on: state.js    (sessionId, currentProject, currentProjectId, messageInput,
//                          isGenerating, messageOffset, totalMessages, hasMoreMessages,
//                          isLoadingHistory, chatContainer, suppressScrollLoad, …)
//             utils.js    (addMessage, scrollToBottom, setSendButtonState,
//                          showAgentStatus, hideAgentStatus, escapeHtml)
//             tools.js    (mergeToolCalls, renderToolCallsList, toggleToolCalls,
//                          pendingToolElements, currentToolContainer, currentToolList)
//             markdown.js (renderMarkdown)
//             sidebar.js  (closeSidebar)
// ---------------------------------------------------------------------------

async function sendMessage() {
  const message = messageInput.value.trim()
  if (!message || isGenerating) return

  // Guard: refuse to send without a chosen project directory. Without a cwd
  // the backend would fall back to its own process.cwd(), running the agent
  // in the wrong folder. The user must pick a project via "New Chat" (or
  // restore/switch to a session that carries one) first.
  if (!currentProject) {
    alert('Please start a "New Chat" and select a project folder first.')
    openProjectSelector()
    return
  }

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
  // Remember what the user sent so we can put it back into the textarea
  // if they cancel the round before it completes.
  pendingUserInput = message
  messageInput.value = ''
  // Shrink the textarea.  This changes the flex layout — the input area
  // gets shorter and the chat container taller, which can push the
  // viewport up.  A synchronous scroll pins us to the bottom before the
  // browser paints, avoiding the visible one-frame jump that
  // requestAnimationFrame (used by scrollToBottom) would cause.
  messageInput.style.height = 'auto'
  chatContainer.scrollTop = chatContainer.scrollHeight

  setSendButtonState('stop')
  showAgentStatus('Working')

  const chatMsg = {
    type: 'chat',
    message,
    sessionId,
    cwd: currentProject || undefined,
    // Read the model directly from the dropdown so changes in settings take
    // effect immediately without needing to sync currentModel.
    model: document.getElementById('modelSelect').value || currentModel || undefined,
  }
  console.log('[sendMessage] Sending:', chatMsg)
  lastChatMessage = chatMsg
  retryCount = 0
  ws.send(JSON.stringify(chatMsg))
}

// ---- History pagination (infinite scroll up) --------------------------------

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

// ---- Message rendering (history) --------------------------------------------

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
        <span class="icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="14" height="14"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76Z"/></svg></span>
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

// ---- Session switching ------------------------------------------------------

async function switchSession(projectId, newSessionId, cwd) {
  closeSidebar()

  // Do NOT cancel the old session's in-flight round — the server uses
  // AsyncLocalStorage to scope each runner's session ID, so multiple
  // sessions can run concurrently without interfering with each other.

  // Clear current chat
  chatContainer.innerHTML = ''
  sessionId = newSessionId
  // Prefer the real cwd from the session data; fall back to the last known
  // project dir from localStorage (set by createNewChat / session_started),
  // then a best-effort reverse of the sanitized projectId.
  // IMPORTANT: denormalizeProjectId is lossy (all non-alphanumeric chars map
  // to '-'), so it must be the last resort.
  currentProject = cwd
    || (function() { try { return localStorage.getItem('lastProjectDir') || '' } catch { return '' } })()
    || denormalizeProjectId(projectId)
    || ''
  currentProjectId = projectId

  // Reset agent status from the previous session
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
function subscribeToSession() {
  if (!sessionId) return
  if (!ws || ws.readyState !== WebSocket.OPEN) return
  // Guard: do NOT send subscribe without a cwd.  The server now refuses to
  // create a runner without one (it used to silently fall back to its own
  // process.cwd(), which pinned the session to the wrong project directory
  // and leaked transcript/memory into it).  This is especially important on
  // auto-restore / reconnect, where currentProject may not be resolved yet.
  // Returning here is safe: the server keeps the client attached on retry,
  // and any later chat/subscribe will (re)create the runner with the cwd.
  if (!currentProject) {
    console.warn('[subscribeToSession] skipping: currentProject is empty')
    return
  }
  ws.send(JSON.stringify({
    type: 'subscribe',
    sessionId,
    cwd: currentProject,
    model: document.getElementById('modelSelect').value || currentModel || undefined,
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

    // Don't restore if the chat already holds real conversation. The welcome
    // message ships with index.html, so it must not count — otherwise every
    // round makes the guard bail and a refresh loses the whole session.
    const realMessages = chatContainer.querySelectorAll('.message:not(#welcomeMessage)')
    if (realMessages.length > 0) return

    sessionId = savedSessionId
    // Prefer the real cwd; fall back to a best-effort reverse of the sanitized
    // projectId.  The server-side projects API is queried below to refine this
    // to the canonical path when cwd was not saved (e.g. older localStorage).
    currentProject = cwd || localStorage.getItem('lastProjectDir') || denormalizeProjectId(projectId) || ''
    currentProjectId = projectId

    // Suppress infinite-scroll handler while restoring
    suppressScrollLoad = true

    // Refine currentProject from the server's project list (authoritative paths)
    const resolveCwd = currentProject
      ? Promise.resolve()
      : fetch('/api/projects')
          .then(r => r.json())
          .then(projects => {
            const match = projects.find(p => p.id === projectId)
            if (match?.path) currentProject = match.path
          })
          .catch(() => {})

    resolveCwd.then(() => {
      // Persist the resolved cwd for future session switches
      if (currentProject) try { localStorage.setItem('lastProjectDir', currentProject) } catch {}
      // Fetch and display session messages via HTTP
      return fetch(`/api/session-messages?project=${encodeURIComponent(projectId)}&session=${encodeURIComponent(savedSessionId)}&offset=0&limit=40`)
        .then(res => res.json())
    })
      .then(data => {
        if (data.messages && data.messages.length > 0) {
          // Remove welcome message before restoring
          document.getElementById('welcomeMessage')?.remove()
          renderSessionMessages(data.messages)
          messageOffset = data.messages.length
          totalMessages = data.total
          hasMoreMessages = data.hasMore

          // Keep pinned to the bottom while content settles
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
