// ---------------------------------------------------------------------------
// sidebar.js — Sidebar toggle, project/session list, edit mode.
// Depends on: state.js   (sessionId, isEditMode)
//             utils.js   (escapeHtml)
//             sessions.js (switchSession — bound as onclick handlers)
// ---------------------------------------------------------------------------

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
        <button class="session-delete-btn" onclick="event.stopPropagation(); deleteSession('${escapeHtml(projectId)}', '${escapeHtml(session.sessionId)}')" title="Delete session">\u00d7</button>
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

// Refresh the sidebar so a freshly-created session appears immediately.
// When the project group isn't in the DOM yet (brand-new project: the server
// only creates the project dir once the first JSONL is written), rebuild the
// whole project list instead of just one session list.
async function refreshSessionList() {
  if (!currentProjectId) return
  if (!document.getElementById(`sessions-${currentProjectId}`)) {
    await loadProjects()
  } else {
    await loadSessions(currentProjectId)
  }
  if (sessionId) {
    document.querySelectorAll('.session-item').forEach(el => el.classList.remove('active'))
    document.querySelector(`.session-item[data-session-id="${sessionId}"]`)?.classList.add('active')
  }
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
