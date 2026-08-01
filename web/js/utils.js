// ---------------------------------------------------------------------------
// utils.js — Generic helper functions (no DOM module logic, no network).
// Depends on: state.js (chatContainer, sendBtn, messageInput, etc.)
// ---------------------------------------------------------------------------

// Disable the browser's automatic scroll-position restoration on reload.
// We manage the chat scroll ourselves (scrollToBottom after loading messages)
// and the browser's restore can race with our rAF-based scroll, leaving the
// viewport mid-conversation instead of at the latest message.
if ('scrollRestoration' in history) {
  history.scrollRestoration = 'manual'
}

// ---- Theme ----------------------------------------------------------------

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

// ---- Scroll ---------------------------------------------------------------

function isNearBottom() {
  // Consider user "near bottom" if within 1 viewport height from the bottom
  return chatContainer.scrollTop + chatContainer.clientHeight >= chatContainer.scrollHeight - chatContainer.clientHeight
}

function scrollToBottom(force = false) {
  // Defer to next frame so layout (scrollHeight) is settled after
  // large innerHTML rewrites. Setting scrollTop synchronously can
  // land short when the browser hasn't computed the new layout yet,
  // causing a visible flicker/jump.
  requestAnimationFrame(() => {
    if (!force && !isNearBottom()) return
    chatContainer.scrollTop = chatContainer.scrollHeight
  })
}

// ---- Escape / misc --------------------------------------------------------

function escapeHtml(text) {
  const div = document.createElement('div')
  div.textContent = text
  return div.innerHTML
}

// ---- Agent status bar -----------------------------------------------------

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

// ---- Send button state ----------------------------------------------------

/**
 * Toggle the Send button between its two roles:
 *  - 'send': shows "Send", disabled when the textarea is empty, enabled otherwise.
 *  - 'stop': shows "Stop", always enabled — clicks cancel the running round.
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

// ---- Chat message helpers -------------------------------------------------

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
