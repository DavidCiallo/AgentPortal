// ---------------------------------------------------------------------------
// events.js — DOM event listeners + application bootstrap.
// Loaded LAST; all functions and DOM refs are already available.
// ---------------------------------------------------------------------------

// ---- Send / Cancel ---------------------------------------------------------

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

// ---- Infinite scroll -------------------------------------------------------

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

// ---- Message input ---------------------------------------------------------

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

// ---- Modals ----------------------------------------------------------------

// Close settings modal when clicking outside
document.getElementById('settingsModal').addEventListener('click', (e) => {
  if (e.target === document.getElementById('settingsModal')) {
    closeSettings()
  }
})

// Close connection-lost modal when clicking outside
document.getElementById('connectionLostModal').addEventListener('click', (e) => {
  if (e.target === document.getElementById('connectionLostModal')) {
    closeConnectionLostModal()
  }
})

// ---- Responsive ------------------------------------------------------------

// Auto-close sidebar when resizing above mobile breakpoint
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
const viewportObserver = new MutationObserver(() => {
  requestAnimationFrame(syncBodyHeight)
})
viewportObserver.observe(document.documentElement, { attributes: true })

// ---- Bootstrap -------------------------------------------------------------

connect()
loadProjects().then(() => {
  // Don't auto-restore last session — start fresh to avoid
  // dumping all previous messages into a new conversation.
  // Users can manually switch to a session from the sidebar.
})
messageInput.focus()
