import * as MTStorage from './multitrack-storage.js'
import { MultitrackPlayer } from './multitrack-player.js'
import { initInlineEdit } from './utils.js'
import { initMultitrackShareButton } from './demo-share-ui.js'

function escapeHtml(str) {
  const div = document.createElement('div')
  div.textContent = str
  return div.innerHTML
}

// Number of lines a `.collapsed` paragraph shows before truncating. Read by
// the CSS clamp via the `--collapsed-lines` custom property (see
// .multitrack-modal__subtitle.collapsed in styles.css).
const COLLAPSED_LINES = 2

// Clamps every `.multitrack-modal__subtitle.collapsed` paragraph inside
// `root` to COLLAPSED_LINES and wires up a "Show more/less" toggle after it.
// Generic over however many such paragraphs exist, so new ones need no JS.
function initCollapsibleText(root) {
  root.querySelectorAll('.multitrack-modal__subtitle.collapsed').forEach((p, i) => {
    p.style.setProperty('--collapsed-lines', COLLAPSED_LINES)
    if (!p.id) p.id = `multitrackSubtitle${i}`

    const toggle = document.createElement('button')
    toggle.type = 'button'
    toggle.className = 'multitrack-modal__subtitle-toggle'
    toggle.textContent = 'Show more'
    toggle.setAttribute('aria-expanded', 'false')
    toggle.setAttribute('aria-controls', p.id)
    p.insertAdjacentElement('afterend', toggle)

    toggle.addEventListener('click', () => {
      const expanded = p.classList.toggle('is-expanded')
      toggle.setAttribute('aria-expanded', String(expanded))
      toggle.textContent = expanded ? 'Show less' : 'Show more'
      // Animate to the paragraph's real content height rather than a
      // guessed cap, so the transition duration matches the actual distance.
      p.style.maxHeight = expanded ? `${p.scrollHeight}px` : ''
    })
  })
}

export function initMultitrack() {
  const section = document.getElementById('multitrack')
  if (!section) return null

  const navLink = document.querySelector('.nav__links a[href="#multitrack"]')
  const closeBtn = document.getElementById('multitrackCloseBtn')

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

  // Swaps the editor view back for the session list, without closing the
  // modal itself — used by the back arrow and after deleting a session.
  function backToList() {
    editorView.hidden = true
    listView.hidden = false
    section.setAttribute('aria-labelledby', 'multitrackModalTitle')
    player?.destroy()
    player = null
    currentSession = null
    currentTracks = []
    renderList()
  }

  function openModal() {
    document.body.style.overflow = 'hidden'
    section.hidden = false
    renderList()
  }

  function closeModal() {
    document.body.style.overflow = ''
    section.hidden = true
    backToList()
  }

  async function openSession(id) {
    currentSession = await MTStorage.getSession(id)
    if (!currentSession) return

    document.body.style.overflow = 'hidden'
    section.hidden = false
    listView.hidden = true
    editorView.hidden = false
    section.setAttribute('aria-labelledby', 'multitrackSessionName')
    nameEl.textContent = currentSession.name

    await refreshPlayer()
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

  navLink?.addEventListener('click', e => {
    e.preventDefault()
    openModal()
  })

  newBtn?.addEventListener('click', async () => {
    const session = await MTStorage.createSession('Untitled Session')
    await openSession(session.id)
  })

  backBtn?.addEventListener('click', backToList)
  closeBtn?.addEventListener('click', closeModal)
  section?.addEventListener('click', e => {
    if (e.target === section) closeModal()
  })
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && !section.hidden) closeModal()
  })

  deleteBtn?.addEventListener('click', async () => {
    if (!currentSession) return
    if (
      !confirm(
        `Delete session "${currentSession.name}"? This cannot be undone.`
      )
    )
      return
    await MTStorage.deleteSession(currentSession.id)
    backToList()
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

  initCollapsibleText(section)
  renderList()

  return {
    openSession,
    // Called by the multitrack-modal drop zone (drop-zone.js), which only
    // ever fires while the modal is open. Creates a session on the fly if
    // none is open yet, so dropping files works from the list view too, not
    // just inside an open session.
    addDroppedFiles: async files => {
      if (!currentSession) {
        const session = await MTStorage.createSession('Untitled Session')
        await openSession(session.id)
      }
      await addFiles(files)
    }
  }
}
