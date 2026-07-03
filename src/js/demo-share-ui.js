import { DemoShare } from './demo-share.js'
import { renderQR } from './qr.js'
import { enter, isReceived, getAlbumName, getAlbumArt } from './demo-mode.js'

// ─── Album art helpers ────────────────────────────────────

const ART_MAX_BYTES = 2 * 1024 * 1024   // 2 MB raw file limit
const ART_MAX_DIM   = 512               // longest edge after resize
const ART_QUALITY   = 0.82
const ART_TYPES     = new Set(['image/jpeg', 'image/png', 'image/webp'])

function processArt(file) {
  if (!ART_TYPES.has(file.type))
    return Promise.reject(new Error('Use JPEG, PNG or WebP'))
  if (file.size > ART_MAX_BYTES)
    return Promise.reject(new Error('Max 2 MB'))
  return new Promise((resolve, reject) => {
    const img = new Image()
    const url = URL.createObjectURL(file)
    img.onload = () => {
      URL.revokeObjectURL(url)
      const scale = Math.min(1, ART_MAX_DIM / Math.max(img.width, img.height))
      const w = Math.round(img.width * scale)
      const h = Math.round(img.height * scale)
      const canvas = document.createElement('canvas')
      canvas.width = w
      canvas.height = h
      canvas.getContext('2d').drawImage(img, 0, 0, w, h)
      resolve(canvas.toDataURL('image/jpeg', ART_QUALITY))
    }
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Could not read image')) }
    img.src = url
  })
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
  const step1              = document.getElementById('shareStep1')
  const step2              = document.getElementById('shareStep2')
  const sessionStateEl     = document.getElementById('shareSessionState')
  const completeStateEl    = document.getElementById('shareCompleteState')
  const canvas             = document.getElementById('shareQr')
  const codeEl             = document.getElementById('shareCode')
  const urlEl              = document.getElementById('shareUrl')
  const status             = document.getElementById('shareStatus')
  const progWrap           = document.getElementById('shareProgressWrap')
  const progFill           = document.getElementById('shareProgressFill')
  const progLabel          = document.getElementById('shareProgressLabel')
  const albumInput         = document.getElementById('shareAlbumName')
  const albumNameEl        = document.getElementById('shareStep2AlbumName')
  const sharedCountEl      = document.getElementById('shareSharedCount')
  const shareSessionCountEl = document.getElementById('shareSessionCount')
  const artDrop            = document.getElementById('shareArtDrop')
  const artInput           = document.getElementById('shareArtInput')
  const artPreview         = document.getElementById('shareArtPreview')
  const artHint            = document.getElementById('shareArtHint')
  const artError           = document.getElementById('shareArtError')
  const continueBtn        = document.getElementById('shareContinueBtn')
  const shareAgainBtn      = document.getElementById('shareAgainBtn')
  const copyBtn            = document.getElementById('shareCopyBtn')
  const closeBtn           = document.getElementById('shareModalClose')

  if (!modal) return

  const received = isReceived()

  // Received albums: pre-fill name, lock input, hide art picker (art comes
  // from storage and is forwarded automatically).
  if (received) {
    albumInput.value = getAlbumName()
    albumInput.disabled = true
    if (artDrop) artDrop.hidden = true
  } else {
    albumInput.disabled = false
    if (artDrop) artDrop.hidden = false
  }

  // Reset to step 1
  step1.hidden = false
  step2.hidden = true
  clearArtBackground(modalBox)
  modal.hidden = false
  if (!albumInput.disabled) {
    albumInput.focus()
    albumInput.select()
  }

  // Album art: for received albums load from storage, otherwise start empty.
  let albumArtDataUrl = received ? getAlbumArt() : null

  // Show a preview if re-opening modal while received art is already set.
  if (albumArtDataUrl && artPreview && artHint) {
    artPreview.src = albumArtDataUrl
    artPreview.hidden = false
    artHint.hidden = true
  }

  let albumName = ''
  let shareUrl = ''
  let sharedCount = 0
  let currentShare = null
  let _sendRafId = null
  let _sendRafPct = 0

  // ─── Art picker (non-received albums only) ────────────────

  const setArt = async file => {
    if (!file) return
    if (artError) artError.hidden = true
    try {
      albumArtDataUrl = await processArt(file)
      if (artPreview) { artPreview.src = albumArtDataUrl; artPreview.hidden = false }
      if (artHint) artHint.hidden = true
    } catch (err) {
      if (artError) { artError.textContent = err.message; artError.hidden = false }
    }
  }

  artInput?.addEventListener('change', e => setArt(e.target.files?.[0]))

  artDrop?.addEventListener('dragover', e => { e.preventDefault(); artDrop.classList.add('is-dragging') })
  artDrop?.addEventListener('dragleave', () => artDrop.classList.remove('is-dragging'))
  artDrop?.addEventListener('drop', e => {
    e.preventDefault()
    artDrop.classList.remove('is-dragging')
    setArt(e.dataTransfer.files?.[0])
  })

  // ─── ──────────────────────────────────────────────────────

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
    albumInput?.removeEventListener('keydown', onAlbumKeydown)
    copyBtn?.removeEventListener('click', onCopy)
    shareAgainBtn?.removeEventListener('click', onShareAgain)
    document.removeEventListener('keydown', onKeydown)
    modal.removeEventListener('click', onBackdropClick)
  }
  const onAlbumKeydown = e => { if (e.key === 'Enter') { e.preventDefault(); continueBtn?.click() } }
  const onKeydown = e => { if (e.key === 'Escape') onClose() }
  const onBackdropClick = e => { if (e.target === modal) onClose() }
  albumInput?.addEventListener('keydown', onAlbumKeydown)
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

  // Continue: finalise album name + art, apply background, show step 2.
  continueBtn?.addEventListener('click', async () => {
    albumName = (albumInput?.value.trim() || 'DEMO').toUpperCase()
    if (albumNameEl) albumNameEl.textContent = albumName
    step1.hidden = true
    step2.hidden = false
    applyArtBackground(modalBox, albumArtDataUrl)
    await startSession()
  }, { once: true })
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
