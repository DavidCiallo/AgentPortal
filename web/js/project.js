// ---------------------------------------------------------------------------
// project.js — "New Chat" project selector modal + directory browser.
// Depends on: state.js    (selectedProjectPath, currentProject, currentProjectId,
//                          sessionId, chatContainer)
//             utils.js    (escapeHtml, addMessage)
//             sidebar.js  (closeSidebar, loadProjects)
// ---------------------------------------------------------------------------

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

    let firstOption = null
    let preferredOption = null

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

      if (!firstOption) firstOption = { path: project.path, el: option }
      // Pre-select the project matching the current session's cwd so the
      // picker opens with the right directory already highlighted.
      // Normalize separators so C:/foo and C:\foo are treated as the same path.
      const norm = s => s.replace(/\\/g, '/').toLowerCase()
      if (currentProject && norm(project.path) === norm(currentProject) && !preferredOption) {
        preferredOption = { path: project.path, el: option }
      }
    })

    // Auto-select: prefer the current project, otherwise the first in the list
    const defaultChoice = preferredOption || firstOption
    if (defaultChoice) selectProject(defaultChoice.path, defaultChoice.el)
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
      parent.innerHTML = '<span class="dir-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="14" height="14"><path d="M3 7v10a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-7l-2-2H5a2 2 0 0 0-2 2Z"/><path d="m10 11 2-2 2 2M12 9v4"/></svg></span> ..'
      parent.onclick = () => loadDirectory(data.parentPath)
      list.appendChild(parent)
    }

    data.entries.forEach(entry => {
      const el = document.createElement('div')
      el.className = 'dir-entry'
      if (!entry.accessible) el.classList.add('dir-inaccessible')
      el.innerHTML = `<span class="dir-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="14" height="14"><path d="M3 7v10a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-7l-2-2H5a2 2 0 0 0-2 2Z"/></svg></span> ${escapeHtml(entry.name)}`
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

  // Persist the chosen project path so that switchSession() can recover it
  // even when the JSONL metadata hasn't been written yet (new sessions).
  localStorage.setItem('lastProjectDir', projectPath)

  // Clear chat and show welcome message
  chatContainer.innerHTML = ''
  addMessage(`Project: ${projectPath}\n\nWhat would you like to work on?`, 'assistant')

  // Remove active state from all sessions
  document.querySelectorAll('.session-item').forEach(el => el.classList.remove('active'))

  // Reload projects to show the new one
  await loadProjects()

  messageInput.focus()
}
