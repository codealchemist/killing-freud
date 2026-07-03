import { DemoShare } from './demo-share.js'
import { renderQR } from './qr.js'
import { enter } from './demo-mode.js'

// ─── Share button (shown in demo banner) ──────────────────

export function initShareButton(tracks) {
  const btn = document.getElementById('demoBannerShare')
  if (!btn) return
  btn.hidden = false
  btn.addEventListener('click', () => _openShareModal(tracks))
}

// ─── Share modal (host/sender) ────────────────────────────

async function _openShareModal(tracks) {
  const modal   = document.getElementById('shareModal')
  const canvas  = document.getElementById('shareQr')
  const codeEl  = document.getElementById('shareCode')
  const urlEl   = document.getElementById('shareUrl')
  const status  = document.getElementById('shareStatus')
  const progWrap = document.getElementById('shareProgressWrap')
  const progFill = document.getElementById('shareProgressFill')
  const progLabel = document.getElementById('shareProgressLabel')
  const copyBtn  = document.getElementById('shareCopyBtn')
  const closeBtn = document.getElementById('shareModalClose')

  if (!modal) return

  // Reset UI
  progWrap.hidden = true
  progFill.style.width = '0%'
  progLabel.textContent = '0%'
  urlEl.textContent = ''
  status.textContent = 'Creating session…'
  modal.hidden = false

  const share = new DemoShare()
  let shareUrl = ''

  share
    .onPeerConnected(async () => {
      status.textContent = 'Peer connected — sending files…'
      try {
        await share.sendTracks(tracks)
      } catch (err) {
        status.textContent = `Transfer failed: ${err.message}`
      }
    })
    .onProgress((sent, total) => {
      progWrap.hidden = false
      const pct = total ? Math.round((sent / total) * 100) : 0
      progFill.style.width = `${pct}%`
      progLabel.textContent = `${pct}%`
    })
    .onComplete(() => {
      status.textContent = 'Transfer complete ✓'
      progFill.style.width = '100%'
      progLabel.textContent = '100%'
    })
    .onError(err => {
      status.textContent = `Error: ${err?.message ?? 'Unknown error'}`
    })

  try {
    const { roomId, shareUrl: url } = await share.startAsHost()
    shareUrl = url

    if (codeEl) codeEl.textContent = roomId
    await renderQR(canvas, shareUrl)
    urlEl.textContent = shareUrl
    status.textContent = 'Waiting for someone to scan…'
  } catch (err) {
    status.textContent = `Failed to start session: ${err.message}`
  }

  // Copy URL
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
  copyBtn?.addEventListener('click', onCopy, { once: false })

  // Close modal
  const onClose = () => {
    modal.hidden = true
    share.destroy()
    copyBtn?.removeEventListener('click', onCopy)
    document.removeEventListener('keydown', onKeydown)
  }
  const onKeydown = e => { if (e.key === 'Escape') onClose() }
  document.addEventListener('keydown', onKeydown)
  closeBtn?.addEventListener('click', onClose, { once: true })

  // Also close on backdrop click
  modal.addEventListener('click', e => {
    if (e.target === modal) onClose()
  })
}

// ─── Incoming session overlay (receiver) ──────────────────

export async function initIncomingSession(roomId) {
  const overlay    = document.getElementById('incomingSession')
  const codeEl     = document.getElementById('incomingCode')
  const acceptBtn  = document.getElementById('incomingAccept')
  const declineBtn = document.getElementById('incomingDecline')
  const status     = document.getElementById('incomingStatus')
  const progWrap   = document.getElementById('incomingProgressWrap')
  const progFill   = document.getElementById('incomingProgressFill')
  const progLabel  = document.getElementById('incomingProgressLabel')

  if (!overlay) return
  overlay.hidden = false
  if (codeEl) codeEl.textContent = roomId

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

    share
      .onFileReceived((info, blob) => {
        receivedFiles.push(new File([blob], info.name, { type: info.mimeType || 'audio/mpeg' }))
      })
      .onProgress((received, total) => {
        progWrap.hidden = false
        const pct = total ? Math.round((received / total) * 100) : 0
        progFill.style.width = `${pct}%`
        progLabel.textContent = `${pct}%`
        status.textContent = 'Receiving files…'
      })
      .onComplete(async () => {
        status.textContent = 'Done! Opening player…'
        progFill.style.width = '100%'
        progLabel.textContent = '100%'
        await new Promise(r => setTimeout(r, 800))
        await enter(receivedFiles)
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
