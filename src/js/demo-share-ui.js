import { DemoShare } from './demo-share.js'
import { renderQR } from './qr.js'
import { enter, getAlbumName, getAlbumArt, incrementShareCount } from './demo-mode.js'
import { importSession as importMultitrackSession } from './multitrack-storage.js'

const MODAL_TITLES = {
  demo: 'Share DEMO Session',
  multitrack: 'Share Multitrack Session'
}
const INCOMING_TITLES = {
  demo: 'Incoming DEMO Session',
  multitrack: 'Incoming Multitrack Session'
}

function applyArtBackground(el, dataUrl) {
  if (!el || !dataUrl) return
  el.style.backgroundImage =
    `linear-gradient(rgba(10,10,10,0.82),rgba(10,10,10,0.82)),url("${dataUrl}")`
  el.style.backgroundSize = 'cover'
  el.style.backgroundPosition = 'center'
}

function clearArtBackground(el) {
  if (!el) return
  el.style.backgroundImage = ''
  el.style.backgroundSize = ''
  el.style.backgroundPosition = ''
}

// Updates the lifetime share-count badges in place so a just-completed
// transfer shows up immediately, in both places it can appear: the album
// modal header (stays mounted underneath the share overlay for the whole
// session — see also opts.shareCount in album-modal.js's open(), which
// covers the reload/reopen path) and the persistent demo banner (always on
// screen, open or closed).
function renderShareCountBadges(count) {
  const label = count === 1 ? '1 share' : `${count} shares`

  const modalEl = document.getElementById('albumModalShareCount')
  const modalNumberEl = document.getElementById('albumModalShareCountNumber')
  if (modalEl) {
    if (modalNumberEl) modalNumberEl.textContent = String(count)
    modalEl.setAttribute('aria-label', label)
    modalEl.title = label
    modalEl.hidden = count === 0
  }

  const bannerEl = document.getElementById('demoBannerShareCount')
  const bannerNumberEl = document.getElementById('demoBannerShareCountNumber')
  if (bannerEl) {
    if (bannerNumberEl) bannerNumberEl.textContent = String(count)
    bannerEl.setAttribute('aria-label', label)
    bannerEl.title = label
  }
}

// ─── Share trigger (called lazily via dynamic import once a Share button
// is clicked, so the WebRTC/QR machinery never loads on an ordinary visit) ──

export function shareDemoSession(tracks) {
  if (!document.getElementById('shareModal')?.hidden) return
  openShareModal({
    kind: 'demo',
    tracks,
    name: getAlbumName(),
    art: getAlbumArt(),
    metadata: null
  })
}

// ─── Share trigger (called lazily from the multitrack editor) ─────────────

export function shareMultitrackSession({ name, tracks, metadata }) {
  if (!tracks?.length) return
  if (!document.getElementById('shareModal')?.hidden) return
  openShareModal({ kind: 'multitrack', tracks, name, art: null, metadata })
}

// ─── Share modal (host/sender) ────────────────────────────

async function openShareModal({ kind, tracks, name, art, metadata }) {
  const modal              = document.getElementById('shareModal')
  const modalBox           = modal?.querySelector('.share-modal__box')
  const modalTitleEl       = document.getElementById('shareModalTitle')
  const sessionStateEl     = document.getElementById('shareSessionState')
  const completeStateEl    = document.getElementById('shareCompleteState')
  const canvas             = document.getElementById('shareQr')
  const codeEl             = document.getElementById('shareCode')
  const urlEl              = document.getElementById('shareUrl')
  const status             = document.getElementById('shareStatus')
  const progWrap           = document.getElementById('shareProgressWrap')
  const progFill           = document.getElementById('shareProgressFill')
  const progLabel          = document.getElementById('shareProgressLabel')
  const nameEl              = document.getElementById('shareStep2AlbumName')
  const sharedCountEl      = document.getElementById('shareSharedCount')
  const shareSessionCountEl = document.getElementById('shareSessionCount')
  const shareAgainBtn      = document.getElementById('shareAgainBtn')
  const copyBtn            = document.getElementById('shareCopyBtn')
  const closeBtn           = document.getElementById('shareModalClose')

  if (!modal) return

  if (modalTitleEl) modalTitleEl.textContent = MODAL_TITLES[kind] || MODAL_TITLES.demo
  if (nameEl) nameEl.textContent = name
  applyArtBackground(modalBox, art)
  modal.hidden = false

  let shareUrl = ''
  let sharedCount = 0
  let currentShare = null
  let _sendRafId = null
  let _sendRafPct = 0

  const updateCount = () => {
    if (sharedCount === 0) {
      if (shareSessionCountEl) shareSessionCountEl.hidden = true
      return
    }
    const text = sharedCount === 1 ? 'Shared with 1 peer' : `Shared with ${sharedCount} peers`
    if (shareSessionCountEl) { shareSessionCountEl.textContent = text; shareSessionCountEl.hidden = false }
    if (sharedCountEl) sharedCountEl.textContent = text
  }

  const onCopy = async () => {
    if (!shareUrl) return
    try {
      await navigator.clipboard.writeText(shareUrl)
      copyBtn.textContent = 'Copied!'
      setTimeout(() => { copyBtn.textContent = 'Copy' }, 2000)
    } catch {
      copyBtn.textContent = 'Copy failed'
      setTimeout(() => { copyBtn.textContent = 'Copy' }, 2000)
    }
  }
  copyBtn?.addEventListener('click', onCopy)

  const onClose = () => {
    modal.hidden = true
    currentShare?.destroy()
    cancelAnimationFrame(_sendRafId)
    clearArtBackground(modalBox)
    copyBtn?.removeEventListener('click', onCopy)
    shareAgainBtn?.removeEventListener('click', onShareAgain)
    document.removeEventListener('keydown', onKeydown)
    modal.removeEventListener('click', onBackdropClick)
  }
  const onKeydown = e => { if (e.key === 'Escape') onClose() }
  const onBackdropClick = e => { if (e.target === modal) onClose() }
  document.addEventListener('keydown', onKeydown)
  closeBtn?.addEventListener('click', onClose, { once: true })
  modal.addEventListener('click', onBackdropClick)

  // startSession creates a fresh WebRTC session using the already-confirmed
  // name. Called once by Continue and again by "Share again".
  const startSession = async () => {
    cancelAnimationFrame(_sendRafId)
    _sendRafId = null
    currentShare?.destroy()
    currentShare = new DemoShare()
    const share = currentShare

    // Reset session UI
    sessionStateEl.hidden = false
    completeStateEl.hidden = true
    progWrap.hidden = true
    progFill.style.width = '0%'
    progLabel.textContent = '0%'
    urlEl.textContent = ''
    status.textContent = 'Creating session…'
    updateCount()

    share
      .onPeerConnected(async () => {
        status.textContent = 'Peer connected — sending files…'
        try {
          await share.sendTracks(tracks, { kind, name, art, metadata })
          sharedCount++
          updateCount()
          if (kind === 'demo') renderShareCountBadges(incrementShareCount())
          sessionStateEl.hidden = true
          completeStateEl.hidden = false
        } catch (err) {
          status.textContent = `Transfer failed: ${err.message}`
        }
      })
      .onProgress((sent, total) => {
        progWrap.hidden = false
        _sendRafPct = total ? Math.round((sent / total) * 100) : 0
        if (_sendRafId) return
        _sendRafId = requestAnimationFrame(() => {
          _sendRafId = null
          progFill.style.width = `${_sendRafPct}%`
          progLabel.textContent = `${_sendRafPct}%`
        })
      })
      .onError(err => {
        status.textContent = `Error: ${err?.message ?? 'Unknown error'}`
      })

    try {
      const { roomId } = await share.startAsHost()
      shareUrl = `${location.origin}${location.pathname}?share=${roomId}&kind=${kind}&name=${encodeURIComponent(name)}`
      if (codeEl) codeEl.textContent = roomId
      await renderQR(canvas, shareUrl)
      urlEl.textContent = shareUrl
      status.textContent = 'Waiting for someone to scan…'
    } catch (err) {
      status.textContent = `Failed to start session: ${err.message}`
    }
  }

  const onShareAgain = () => startSession()
  shareAgainBtn?.addEventListener('click', onShareAgain)

  // Name and art already set above — start the session immediately.
  startSession()
}

// ─── Incoming session overlay (receiver) ──────────────────

export async function initIncomingSession(roomId, kind = 'demo', name) {
  const overlay      = document.getElementById('incomingSession')
  const overlayBox   = overlay?.querySelector('.incoming-session__box')
  const overlayTitle = document.getElementById('incomingSessionTitle')
  const codeEl       = document.getElementById('incomingCode')
  const nameEl       = document.getElementById('incomingAlbum')
  const actionsEl    = document.getElementById('incomingActions')
  const acceptBtn    = document.getElementById('incomingAccept')
  const declineBtn   = document.getElementById('incomingDecline')
  const cancelBtn    = document.getElementById('incomingCancel')
  const status       = document.getElementById('incomingStatus')
  const progWrap     = document.getElementById('incomingProgressWrap')
  const progFill     = document.getElementById('incomingProgressFill')
  const progLabel    = document.getElementById('incomingProgressLabel')

  if (!overlay) return
  overlay.hidden = false
  if (overlayTitle) overlayTitle.textContent = INCOMING_TITLES[kind] || INCOMING_TITLES.demo
  if (codeEl) codeEl.textContent = roomId
  if (nameEl && name) {
    nameEl.textContent = name
    nameEl.hidden = false
  }

  // Clean the URL so a reload after accepting won't retrigger
  const cleanUrl = `${location.origin}${location.pathname}`
  history.replaceState(null, '', cleanUrl)

  const closeOverlay = () => {
    overlay.hidden = true
    clearArtBackground(overlayBox)
    document.removeEventListener('keydown', onOverlayKeydown)
  }
  const onOverlayKeydown = e => { if (e.key === 'Escape') closeOverlay() }
  document.addEventListener('keydown', onOverlayKeydown)

  declineBtn?.addEventListener('click', () => {
    closeOverlay()
  }, { once: true })

  acceptBtn?.addEventListener('click', async () => {
    // Replace action buttons with a single Cancel button
    actionsEl.hidden = true
    cancelBtn.hidden = false
    status.textContent = 'Connecting…'

    const share = new DemoShare()
    const receivedFiles = []
    let _recvRafId = null
    let _recvRafPct = 0

    const doCancel = () => {
      share.destroy()
      receivedFiles.length = 0
      cancelAnimationFrame(_recvRafId)
      closeOverlay()
    }
    cancelBtn.addEventListener('click', doCancel, { once: true })

    share
      .onAlbumArt(dataUrl => applyArtBackground(overlayBox, dataUrl))
      .onFileReceived((info, blob) => {
        receivedFiles.push(new File([blob], info.name, { type: info.mimeType || 'audio/mpeg' }))
      })
      .onProgress((received, total) => {
        progWrap.hidden = false
        _recvRafPct = total ? Math.round((received / total) * 100) : 0
        if (_recvRafId) return
        _recvRafId = requestAnimationFrame(() => {
          _recvRafId = null
          progFill.style.width = `${_recvRafPct}%`
          progLabel.textContent = `${_recvRafPct}%`
          status.textContent = 'Receiving files…'
        })
      })
      .onComplete(async (recvKind, recvName, recvArt, recvMetadata) => {
        cancelAnimationFrame(_recvRafId)
        _recvRafId = null
        cancelBtn.hidden = true
        status.textContent = 'Done! Opening…'
        progFill.style.width = '100%'
        progLabel.textContent = '100%'
        await new Promise(r => setTimeout(r, 800))

        if (recvKind === 'multitrack') {
          const session = await importMultitrackSession(recvName, receivedFiles, recvMetadata)
          const url = new URL(`${location.origin}${location.pathname}`)
          url.searchParams.set('open-session', session.id)
          url.hash = 'multitrack'
          location.href = url.toString()
          return
        }

        await enter(receivedFiles, recvName, true, recvArt)
        // enter() calls location.reload() — page ends here
      })
      .onError(err => {
        status.textContent = `Error: ${err?.message ?? 'Connection failed'}`
      })

    try {
      await share.joinAsReceiver(roomId)
      status.textContent = 'Waiting for files…'
    } catch (err) {
      // Connection failed before starting — restore action buttons
      cancelBtn.removeEventListener('click', doCancel)
      cancelBtn.hidden = true
      actionsEl.hidden = false
      status.textContent = err.message
    }
  }, { once: true })
}
