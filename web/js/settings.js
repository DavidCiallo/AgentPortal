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
