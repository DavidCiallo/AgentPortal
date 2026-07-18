// ---------------------------------------------------------------------------
// state.js — Global mutable state shared across all UI modules.
// Loaded first; every other file reads/writes these variables.
// ---------------------------------------------------------------------------

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
let pendingToolElements = new Map()  // toolUseId -> rendered DOM element, for live output updates
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

// DOM references (resolved once at load time)
const chatContainer = document.getElementById('chatContainer')
const messageInput  = document.getElementById('messageInput')
const sendBtn       = document.getElementById('sendBtn')
const agentStatusEl = document.getElementById('agentStatus')
const agentStatusDot = agentStatusEl?.querySelector('.agent-status-dot')
const agentStatusText = document.getElementById('agentStatusText')

// Agent working status — persistent indicator at bottom-bar
let agentStatusStart = 0
let agentStatusInterval = null
let _connected = false

// Infinite scroll guard
let suppressScrollLoad = false
let scrollLoadTimer = null

// Project selector
let selectedProjectPath = ''

// Convert a sanitized projectId (e.g. "C-items-Tiny-Web") back to a real path.
// Mirrors the server's denormalizeProjectName() so the client can resolve
// paths without an extra HTTP round-trip.
function denormalizeProjectId(sanitized) {
  const parts = sanitized.split('-').filter(p => p.length > 0)
  // Windows drive letter: "C-items-..." → "C:/items/..."
  if (parts.length >= 2 && parts[0].length === 1 && /^[A-Z]$/i.test(parts[0])) {
    return parts[0] + ':\\' + parts.slice(1).join('\\')
  }
  // Unix: "Users-foo-project" → "/Users/foo/project"
  return '/' + parts.join('/')
}
