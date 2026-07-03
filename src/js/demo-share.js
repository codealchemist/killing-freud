const CHUNK_SIZE = 64 * 1024       // 64 KB — safe across all browsers
const MAX_BUFFERED = 2 * 1024 * 1024 // pause sending above 2 MB buffered
const POLL_INTERVAL = 500            // ms between answer polls
const ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' }
]
const ROOM_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789' // no 0/O/1/I ambiguity

function generateRoomId() {
  const bytes = crypto.getRandomValues(new Uint8Array(6))
  return Array.from(bytes).map(b => ROOM_CHARS[b % ROOM_CHARS.length]).join('')
}

async function postSignal(room, role, payload) {
  const res = await fetch(`/api/signal?room=${room}&role=${role}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  })
  if (!res.ok) throw new Error(`Signal POST failed: ${res.status}`)
}

async function pollSignal(room, role, signal) {
  while (!signal.aborted) {
    try {
      const res = await fetch(`/api/signal?room=${room}&role=${role}`, { signal })
      if (res.ok) return await res.json()
    } catch (err) {
      if (err.name === 'AbortError') throw err
    }
    // Interruptible sleep
    await new Promise((resolve, reject) => {
      const t = setTimeout(resolve, POLL_INTERVAL)
      signal.addEventListener('abort', () => { clearTimeout(t); reject(new DOMException('Aborted', 'AbortError')) }, { once: true })
    })
  }
  throw new DOMException('Aborted', 'AbortError')
}

async function waitForIceGathering(pc) {
  if (pc.iceGatheringState === 'complete') return
  return new Promise(resolve => {
    function check() {
      if (pc.iceGatheringState === 'complete') {
        pc.removeEventListener('icegatheringstatechange', check)
        resolve()
      }
    }
    pc.addEventListener('icegatheringstatechange', check)
  })
}

export class DemoShare {
  constructor() {
    this._pc = null
    this._dc = null
    this._abort = new AbortController()
    this._onPeerConnected = null
    this._onProgress = null
    this._onComplete = null
    this._onError = null
    this._onFileReceived = null
  }

  // ─── Callback setters (chainable) ─────────────────────────

  onPeerConnected(cb) { this._onPeerConnected = cb; return this }
  onProgress(cb)      { this._onProgress = cb; return this }
  onComplete(cb)      { this._onComplete = cb; return this }
  onError(cb)         { this._onError = cb; return this }
  onFileReceived(cb)  { this._onFileReceived = cb; return this }

  // ─── Host (sender) ────────────────────────────────────────

  async startAsHost() {
    const roomId = generateRoomId()
    const shareUrl = `${location.origin}${location.pathname}?demo-share=${roomId}`

    this._pc = new RTCPeerConnection({ iceServers: ICE_SERVERS })
    this._dc = this._pc.createDataChannel('files')
    this._dc.binaryType = 'arraybuffer'

    this._dc.addEventListener('open', () => {
      if (this._onPeerConnected) this._onPeerConnected()
    })
    this._dc.addEventListener('error', e => {
      if (this._onError) this._onError(e.error ?? new Error('DataChannel error'))
    })

    const offer = await this._pc.createOffer()
    await this._pc.setLocalDescription(offer)
    await waitForIceGathering(this._pc)

    await postSignal(roomId, 'offer', {
      sdp: this._pc.localDescription.sdp,
      type: this._pc.localDescription.type
    })

    // Wait for receiver's answer in background
    this._awaitAnswer(roomId)

    return { roomId, shareUrl }
  }

  async _awaitAnswer(roomId) {
    try {
      const answer = await pollSignal(roomId, 'answer', this._abort.signal)
      await this._pc.setRemoteDescription(new RTCSessionDescription(answer))
    } catch (err) {
      if (err.name !== 'AbortError' && this._onError) this._onError(err)
    }
  }

  // ─── Receiver ─────────────────────────────────────────────

  async joinAsReceiver(roomId) {
    const res = await fetch(`/api/signal?room=${roomId}&role=offer`)
    if (!res.ok) throw new Error('Session not found or expired — ask the host to share again.')
    const offerData = await res.json()

    this._pc = new RTCPeerConnection({ iceServers: ICE_SERVERS })

    this._pc.addEventListener('datachannel', e => {
      this._dc = e.channel
      this._dc.binaryType = 'arraybuffer'
      this._setupReceiveChannel(this._dc)
    })

    await this._pc.setRemoteDescription(new RTCSessionDescription(offerData))
    const answer = await this._pc.createAnswer()
    await this._pc.setLocalDescription(answer)
    await waitForIceGathering(this._pc)

    await postSignal(roomId, 'answer', {
      sdp: this._pc.localDescription.sdp,
      type: this._pc.localDescription.type
    })
  }

  // ─── Receive channel handler ───────────────────────────────

  _setupReceiveChannel(dc) {
    let currentFile = null
    let chunks = []
    let receivedBytes = 0
    let totalBytes = 0

    dc.addEventListener('message', async e => {
      if (typeof e.data === 'string') {
        const msg = JSON.parse(e.data)

        if (msg.type === 'MANIFEST') {
          totalBytes = msg.files.reduce((s, f) => s + f.size, 0)
        }

        if (msg.type === 'FILE_START') {
          currentFile = { id: msg.id, name: msg.name, size: msg.size }
          chunks = []
        }

        if (msg.type === 'FILE_END' && currentFile) {
          const blob = new Blob(chunks)
          if (this._onFileReceived) this._onFileReceived(currentFile, blob)
          currentFile = null
          chunks = []
        }

        if (msg.type === 'ALL_DONE') {
          if (this._onComplete) this._onComplete()
        }
      } else {
        // Binary chunk
        chunks.push(e.data)
        receivedBytes += e.data.byteLength
        if (this._onProgress) this._onProgress(receivedBytes, totalBytes)
      }
    })

    dc.addEventListener('error', e => {
      if (this._onError) this._onError(e.error ?? new Error('DataChannel error'))
    })
  }

  // ─── File transfer (host calls this after peer connects) ──

  async sendTracks(tracks) {
    const dc = this._dc
    if (!dc || dc.readyState !== 'open') throw new Error('DataChannel not open')

    const totalBytes = tracks.reduce((s, t) => s + (t.size || 0), 0)
    let sentBytes = 0

    dc.send(JSON.stringify({
      type: 'MANIFEST',
      files: tracks.map(t => ({ id: t.id, name: t.name, size: t.size }))
    }))

    for (const track of tracks) {
      const buffer = await track.blob.arrayBuffer()
      const totalChunks = Math.ceil(buffer.byteLength / CHUNK_SIZE)

      dc.send(JSON.stringify({
        type: 'FILE_START',
        id: track.id,
        name: track.name,
        size: track.size,
        totalChunks
      }))

      for (let i = 0; i < totalChunks; i++) {
        // Backpressure: wait while the send buffer is too full
        while (dc.bufferedAmount > MAX_BUFFERED) {
          await new Promise(r => setTimeout(r, 50))
        }
        const chunk = buffer.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE)
        dc.send(chunk)
        sentBytes += chunk.byteLength
        if (this._onProgress) this._onProgress(sentBytes, totalBytes)
      }

      dc.send(JSON.stringify({ type: 'FILE_END', id: track.id }))
    }

    dc.send(JSON.stringify({ type: 'ALL_DONE' }))
  }

  // ─── Cleanup ──────────────────────────────────────────────

  destroy() {
    this._abort.abort()
    try { this._dc?.close() } catch { /* ignore */ }
    try { this._pc?.close() } catch { /* ignore */ }
  }
}
