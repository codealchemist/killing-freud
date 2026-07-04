import { DemoShare } from './demo-share.js'
import { renderQR } from './qr.js'
import { enter, getAlbumName, getAlbumArt } from './demo-mode.js'

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

// ─── Share button (shown in demo banner) ──────────────────

export function initShareButton(tracks) {
  const btn = document.getElementById('demoBannerShare')
  if (!btn) return
  btn.hidden = false
  btn.addEventListener('click', () => {
    if (!document.getElementById('shareModal')?.hidden) return
    _openShareModal(tracks)
  })
}

// ─── Share modal (host/sender) ────────────────────────────

async function _openShareModal(tracks) {
  const modal              = document.getElementById('shareModal')
  const modalBox           = modal?.querySelector('.share-modal__box')
  const sessionStateEl     = document.getElementById('shareSessionState')
  const completeStateEl    = document.getElementById('shareCompleteState')
  const canvas             = document.getElementById('shareQr')
  const codeEl             = document.getElementById('shareCode')
  const urlEl              = document.getElementById('shareUrl')
  const status             = document.getElementById('shareStatus')
  const progWrap           = document.getElementById('shareProgressWrap')
  const progFill           = document.getElementById('shareProgressFill')
  const progLabel          = document.getElementById('shareProgressLabel')
  const albumNameEl        = document.getElementById('shareStep2AlbumName')
  const sharedCountEl      = document.getElementById('shareSharedCount')
  const shareSessionCountEl = document.getElementById('shareSessionCount')
  const shareAgainBtn      = document.getElementById('shareAgainBtn')
  const copyBtn            = document.getElementById('shareCopyBtn')
  const closeBtn           = document.getElementById('shareModalClose')

  if (!modal) return

  // Album name and art come from the main-view controls, not the modal.
  const albumName     = getAlbumName()
  const albumArtDataUrl = getAlbumArt()

  if (albumNameEl) albumNameEl.textContent = albumName
  applyArtBackground(modalBox, albumArtDataUrl)
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
  // albumName. Called once by Continue and again by "Share again".
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
          await share.sendTracks(tracks, albumName, albumArtDataUrl)
          sharedCount++
          updateCount()
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
      shareUrl = `${location.origin}${location.pathname}?demo-share=${roomId}&album=${encodeURIComponent(albumName)}`
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

export async function initIncomingSession(roomId, albumName) {
  const overlay    = document.getElementById('incomingSession')
  const overlayBox = overlay?.querySelector('.incoming-session__box')
  const codeEl     = document.getElementById('incomingCode')
  const albumEl    = document.getElementById('incomingAlbum')
  const actionsEl  = document.getElementById('incomingActions')
  const acceptBtn  = document.getElementById('incomingAccept')
  const declineBtn = document.getElementById('incomingDecline')
  const cancelBtn  = document.getElementById('incomingCancel')
  const status     = document.getElementById('incomingStatus')
  const progWrap   = document.getElementById('incomingProgressWrap')
  const progFill   = document.getElementById('incomingProgressFill')
  const progLabel  = document.getElementById('incomingProgressLabel')

  if (!overlay) return
  overlay.hidden = false
  if (codeEl) codeEl.textContent = roomId
  if (albumEl && albumName) {
    albumEl.textContent = albumName
    albumEl.hidden = false
  }

  // Clean the URL so a reload after entering demo mode won't retrigger
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
      .onComplete(async (albumName, albumArt) => {
        cancelAnimationFrame(_recvRafId)
        _recvRafId = null
        cancelBtn.hidden = true
        status.textContent = 'Done! Opening player…'
        progFill.style.width = '100%'
        progLabel.textContent = '100%'
        await new Promise(r => setTimeout(r, 800))
        await enter(receivedFiles, albumName, true, albumArt)
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
