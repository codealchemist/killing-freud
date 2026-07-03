import { DemoShare } from './demo-share.js'
import { renderQR } from './qr.js'
import { enter } from './demo-mode.js'

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
  const modal       = document.getElementById('shareModal')
  const step1       = document.getElementById('shareStep1')
  const step2       = document.getElementById('shareStep2')
  const canvas      = document.getElementById('shareQr')
  const codeEl      = document.getElementById('shareCode')
  const urlEl       = document.getElementById('shareUrl')
  const status      = document.getElementById('shareStatus')
  const progWrap    = document.getElementById('shareProgressWrap')
  const progFill    = document.getElementById('shareProgressFill')
  const progLabel   = document.getElementById('shareProgressLabel')
  const albumInput  = document.getElementById('shareAlbumName')
  const continueBtn    = document.getElementById('shareContinueBtn')
  const albumNameEl    = document.getElementById('shareStep2AlbumName')
  const copyBtn        = document.getElementById('shareCopyBtn')
  const closeBtn    = document.getElementById('shareModalClose')

  if (!modal) return

  // Reset to step 1
  step1.hidden = false
  step2.hidden = true
  progWrap.hidden = true
  progFill.style.width = '0%'
  progLabel.textContent = '0%'
  urlEl.textContent = ''
  modal.hidden = false
  albumInput?.focus()
  albumInput?.select()

  const share = new DemoShare()
  let shareUrl = ''
  let albumName = ''

  let _sendRafId = null
  let _sendRafPct = 0

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
    share.destroy()
    cancelAnimationFrame(_sendRafId)
    albumInput?.removeEventListener('keydown', onAlbumKeydown)
    copyBtn?.removeEventListener('click', onCopy)
    document.removeEventListener('keydown', onKeydown)
    modal.removeEventListener('click', onBackdropClick)
  }
  // Enter in album input advances to Continue
  const onAlbumKeydown = e => { if (e.key === 'Enter') { e.preventDefault(); continueBtn?.click() } }
  const onKeydown = e => { if (e.key === 'Escape') onClose() }
  const onBackdropClick = e => { if (e.target === modal) onClose() }
  albumInput?.addEventListener('keydown', onAlbumKeydown)
  document.addEventListener('keydown', onKeydown)
  closeBtn?.addEventListener('click', onClose, { once: true })
  modal.addEventListener('click', onBackdropClick)

  share
    .onPeerConnected(async () => {
      status.textContent = 'Peer connected — sending files…'
      try {
        await share.sendTracks(tracks, albumName)
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
    .onComplete(() => {
      cancelAnimationFrame(_sendRafId)
      _sendRafId = null
      status.textContent = 'Transfer complete ✓'
      progFill.style.width = '100%'
      progLabel.textContent = '100%'
    })
    .onError(err => {
      status.textContent = `Error: ${err?.message ?? 'Unknown error'}`
    })

  // Continue: lock album name, switch to step 2, then start WebRTC session.
  // startAsHost() is intentionally deferred to here so the offer blob is only
  // written to the signal store once the album name is final.
  continueBtn?.addEventListener('click', async () => {
    albumName = (albumInput?.value.trim() || 'DEMO').toUpperCase()
    if (albumNameEl) albumNameEl.textContent = albumName
    step1.hidden = true
    step2.hidden = false
    status.textContent = 'Creating session…'

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
  }, { once: true })
}

// ─── Incoming session overlay (receiver) ──────────────────

export async function initIncomingSession(roomId, albumName) {
  const overlay    = document.getElementById('incomingSession')
  const codeEl     = document.getElementById('incomingCode')
  const albumEl    = document.getElementById('incomingAlbum')
  const acceptBtn  = document.getElementById('incomingAccept')
  const declineBtn = document.getElementById('incomingDecline')
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
    document.removeEventListener('keydown', onOverlayKeydown)
  }
  const onOverlayKeydown = e => { if (e.key === 'Escape') closeOverlay() }
  document.addEventListener('keydown', onOverlayKeydown)

  declineBtn?.addEventListener('click', () => {
    closeOverlay()
  }, { once: true })

  acceptBtn?.addEventListener('click', async () => {
    acceptBtn.disabled = true
    declineBtn.disabled = true
    status.textContent = 'Connecting…'

    const share = new DemoShare()
    const receivedFiles = []
    let _recvRafId = null
    let _recvRafPct = 0

    share
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
      .onComplete(async (albumName) => {
        cancelAnimationFrame(_recvRafId)
        _recvRafId = null
        status.textContent = 'Done! Opening player…'
        progFill.style.width = '100%'
        progLabel.textContent = '100%'
        await new Promise(r => setTimeout(r, 800))
        await enter(receivedFiles, albumName)
        // enter() calls location.reload() — page ends here
      })
      .onError(err => {
        status.textContent = `Error: ${err?.message ?? 'Connection failed'}`
        acceptBtn.disabled = false
        declineBtn.disabled = false
      })

    try {
      await share.joinAsReceiver(roomId)
      status.textContent = 'Waiting for files…'
    } catch (err) {
      status.textContent = err.message
      acceptBtn.disabled = false
      declineBtn.disabled = false
    }
  }, { once: true })
}
