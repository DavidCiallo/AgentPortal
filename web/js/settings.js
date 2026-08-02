// ---------------------------------------------------------------------------
// settings.js — Settings modal: open/close, config load/save, model fetching.
// Depends on: state.js   (ws, currentModel, currentProject, currentProjectId)
//             utils.js   (escapeHtml)
// ---------------------------------------------------------------------------

// Restore show-tools state (default: expanded)
const savedShowTools = localStorage.getItem('showTools') !== '0'
document.getElementById('showToolsToggle').checked = savedShowTools

// Initialize theme
setTheme(getTheme())

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

  // Note: do NOT adopt config.cwd (the server's process.cwd) as the project
  // directory — that would cause new sessions to run in wherever the server
  // was launched from. currentProject must come from the user explicitly
  // choosing a project (createNewChat) or restoring a previous session.

  // Fetch available models from the API and populate the dropdown
  fetchModelsAndPopulateSelect(config.model)
}

async function refreshModels() {
  const baseUrl = document.getElementById('baseUrlInput').value
  const apiKey = document.getElementById('apiKeyInput').value
  // The masked placeholder means "keep the saved key" — omit it so the
  // server falls back to the profile's key.
  const apiKeyOverride = apiKey && apiKey !== '••••••••' ? apiKey : undefined
  await fetchModelsAndPopulateSelect(document.getElementById('modelSelect').value, baseUrl, apiKeyOverride)
}

// Auto-refresh the model list when the Base URL changes so the user sees
// the new provider's models immediately after editing the field.
let baseUrlAutoRefreshTimer = null
function onBaseUrlInput() {
  clearTimeout(baseUrlAutoRefreshTimer)
  baseUrlAutoRefreshTimer = setTimeout(() => {
    const baseUrl = document.getElementById('baseUrlInput').value.trim()
    if (!/^https?:\/\/.+/.test(baseUrl)) return
    refreshModels()
  }, 800)
}

async function fetchModelsAndPopulateSelect(currentModelValue, baseUrlOverride, apiKeyOverride) {
  const modelSelect = document.getElementById('modelSelect')
  // Show loading state
  modelSelect.innerHTML = '<option value="">Loading models...</option>'
  modelSelect.disabled = true

  try {
    let url = '/api/models'
    const params = new URLSearchParams()
    if (baseUrlOverride) params.set('baseUrl', baseUrlOverride)
    if (apiKeyOverride) params.set('apiKey', apiKeyOverride)
    const qs = params.toString()
    if (qs) url += '?' + qs
    const response = await fetch(url)
    const data = await response.json()

    modelSelect.innerHTML = ''

    if (data.models && data.models.length > 0) {
      const sorted = [...data.models].sort()
      for (const modelId of sorted) {
        const opt = document.createElement('option')
        opt.value = modelId
        opt.textContent = modelId
        modelSelect.appendChild(opt)
      }
    } else {
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
    statusEl.style.background = 'color-mix(in srgb, var(--info) 12%, transparent)'
    statusEl.style.borderColor = 'color-mix(in srgb, var(--info) 35%, transparent)'
    statusEl.style.color = 'var(--info)'
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
