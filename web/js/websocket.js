// ---------------------------------------------------------------------------
// websocket.js — WebSocket connection lifecycle + incoming message handler.
// Depends on: state.js   (ws, sessionId, currentProject, currentProjectId, …)
//             utils.js   (setConnectionStatus, setSendButtonState, showAgentStatus,
//                          hideAgentStatus, scrollToBottom, addMessage, escapeHtml)
//             tools.js   (renderToolCallLive, pendingToolElements, …)
//             markdown.js (renderMarkdown)
//             sessions.js (renderSessionMessages, loadSessions — called from 'done')
//             settings.js (loadConfig, showConfigStatus)
// ---------------------------------------------------------------------------

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
      handleMessage(msg)
    } catch (e) {
      console.error('[ws] Error parsing message:', e, event.data)
    }
  }
}

function handleMessage(msg) {
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
      // group. Without this, tool A -> text -> tool A would merge the two
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
        const projectDir = currentProjectId
          || (currentProject ? currentProject.replace(/[/\\:]/g, '-') : 'unknown')
        localStorage.setItem('lastSession', JSON.stringify({
          projectId: projectDir,
          sessionId,
          cwd: currentProject || '',
        }))

        // Refresh the sidebar so a brand-new conversation appears in the
        // list immediately.
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
      if (msg.cwd) {
        currentProject = msg.cwd
        try { localStorage.setItem('lastProjectDir', msg.cwd) } catch {}
      }
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
