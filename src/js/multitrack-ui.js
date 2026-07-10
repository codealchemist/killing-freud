import * as MTStorage from './multitrack-storage.js'
import { MultitrackPlayer } from './multitrack-player.js'
import { initInlineEdit } from './utils.js'
import { initMultitrackShareButton } from './demo-share-ui.js'

function escapeHtml(str) {
  const div = document.createElement('div')
  div.textContent = str
  return div.innerHTML
}

export function initMultitrack() {
  const section = document.getElementById('multitrack')
  if (!section) return null

  const listView = document.getElementById('multitrackList')
  const sessionsGrid = document.getElementById('multitrackSessions')
  const emptyEl = document.getElementById('multitrackEmpty')
  const newBtn = document.getElementById('multitrackNewBtn')

  const editorView = document.getElementById('multitrackEditor')
  const backBtn = document.getElementById('multitrackBackBtn')
  const nameEl = document.getElementById('multitrackSessionName')
  const nameInput = document.getElementById('multitrackNameInput')
  const editNameBtn = document.getElementById('multitrackEditNameBtn')
  const deleteBtn = document.getElementById('multitrackDeleteBtn')
  const fileInput = document.getElementById('multitrackFileInput')
  const dropZone = document.getElementById('multitrackDropZone')
  const playerRoot = document.getElementById('multitrackPlayerRoot')
  const editorEmpty = document.getElementById('multitrackEditorEmpty')

  let player = null
  let currentSession = null
  let currentTracks = []

  async function renderList() {
    const sessions = await MTStorage.listSessions()
    sessionsGrid.innerHTML = ''
    emptyEl.hidden = sessions.length > 0

    sessions.forEach(session => {
      const count = session.trackOrder.length
      const card = document.createElement('div')
      card.className = 'multitrack-card'
      card.tabIndex = 0
      card.setAttribute('role', 'button')
      card.innerHTML = `
        <span class="multitrack-card__name">${escapeHtml(session.name)}</span>
        <span class="multitrack-card__meta">${count} track${count === 1 ? '' : 's'} · ${new Date(session.updatedAt).toLocaleDateString()}</span>
      `
      card.addEventListener('click', () => openSession(session.id))
      card.addEventListener('keydown', e => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          openSession(session.id)
        }
      })
      sessionsGrid.appendChild(card)
    })
  }

  async function openSession(id) {
    currentSession = await MTStorage.getSession(id)
    if (!currentSession) return

    document.body.classList.add('multitrack-mode')
    listView.hidden = true
    editorView.hidden = false
    nameEl.textContent = currentSession.name

    await refreshPlayer()
  }

  function closeEditor() {
    document.body.classList.remove('multitrack-mode')
    editorView.hidden = true
    listView.hidden = false
    player?.destroy()
    player = null
    currentSession = null
    currentTracks = []
    renderList()
  }

  async function removeTrack(trackId) {
    const track = currentTracks.find(t => t.id === trackId)
    if (!currentSession || !track) return
    await MTStorage.removeTrackFromSession(currentSession.id, trackId)
    await refreshPlayer()
  }

  async function refreshPlayer() {
    const tracks = await MTStorage.getSessionTracks(currentSession.id)
    currentTracks = tracks
    editorEmpty.hidden = tracks.length > 0
    playerRoot.hidden = tracks.length === 0

    if (!tracks.length) {
      player?.destroy()
      player = null
      return
    }

    if (!player) {
      player = new MultitrackPlayer(playerRoot)
      player.onTrackStateChange((trackId, state) => {
        MTStorage.updateTrackState(currentSession.id, trackId, state)
      })
      player.onError(err =>
        console.warn('Multitrack player error:', err.message)
      )
      player.onRemoveTrack(trackId => removeTrack(trackId))
    }

    await player.load(tracks)
  }

  async function addFiles(fileList) {
    const files = Array.from(fileList).filter(f => f.type.startsWith('audio/'))
    if (!files.length || !currentSession) return
    await MTStorage.addTracksToSession(currentSession.id, files)
    await refreshPlayer()
  }

  newBtn?.addEventListener('click', async () => {
    const session = await MTStorage.createSession('Untitled Session')
    await openSession(session.id)
  })

  backBtn?.addEventListener('click', closeEditor)

  deleteBtn?.addEventListener('click', async () => {
    if (!currentSession) return
    if (
      !confirm(
        `Delete session "${currentSession.name}"? This cannot be undone.`
      )
    )
      return
    await MTStorage.deleteSession(currentSession.id)
    closeEditor()
  })

  fileInput?.addEventListener('change', e => {
    addFiles(e.target.files)
    fileInput.value = ''
  })
  dropZone?.addEventListener('click', () => fileInput?.click())
  dropZone?.addEventListener('keydown', e => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      fileInput?.click()
    }
  })

  initInlineEdit({
    displayEl: nameEl,
    inputEl: nameInput,
    editBtn: editNameBtn,
    fallback: 'Untitled Session',
    onCommit: async name => {
      currentSession = await MTStorage.renameSession(currentSession.id, name)
    }
  })

  initMultitrackShareButton(async () => {
    const tracks = await MTStorage.getSessionTracks(currentSession.id)
    return {
      name: currentSession.name,
      tracks: tracks.map(t => ({
        id: t.id,
        name: t.name,
        size: t.size,
        blob: t.blob
      })),
      metadata: { trackState: tracks.map(t => t.state) }
    }
  })

  renderList()

  return {
    openSession,
    // Called by the multitrack-section drop zone (drop-zone.js). Creates a
    // session on the fly if none is open yet, so dropping files on the
    // section works from the list view too, not just inside an open editor.
    addDroppedFiles: async files => {
      if (!currentSession) {
        const session = await MTStorage.createSession('Untitled Session')
        await openSession(session.id)
      }
      await addFiles(files)
    }
  }
}
