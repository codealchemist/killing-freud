# DEMO Share — WebRTC Audio Sharing Plan

## Executive Summary

When in DEMO mode, the user can tap a **Share** button to generate a short room code, a shareable URL, and a QR code. A second instance of the app — on any device, anywhere — opens that URL, accepts the incoming session, and receives all audio files peer-to-peer via WebRTC DataChannel. Once transfer completes the receiver is automatically dropped into DEMO mode with the same tracks, without the files ever touching a server.

---

## Architecture Overview

```
┌─────────────────────────────┐         ┌─────────────────────────────┐
│  Device A  (Sender)         │         │  Device B  (Receiver)       │
│                             │         │                             │
│  DEMO mode active           │         │  Opens share URL / QR       │
│  AudioPlayer (local blobs)  │         │  ?demo-share=X7K9MQ         │
│                             │         │                             │
│  RTCPeerConnection          │◄───────►│  RTCPeerConnection          │
│  RTCDataChannel "files"     │  P2P    │  RTCDataChannel "files"     │
│                             │  audio  │                             │
│  sends chunked blobs        │  data   │  reassembles → IndexedDB    │
└────────────┬────────────────┘         └──────────────┬──────────────┘
             │  SDP offer + ICE                        │  SDP answer + ICE
             │  (HTTP POST, once)                      │  (HTTP POST, once)
             ▼                                         ▼
┌─────────────────────────────────────────────────────────────────────┐
│  Netlify Function  /api/signal                                      │
│  Netlify Blobs (key-value, TTL 5 min)                              │
│                                                                     │
│  {roomId}/offer   → SDP + ICE candidates from Sender               │
│  {roomId}/answer  → SDP + ICE candidates from Receiver             │
└─────────────────────────────────────────────────────────────────────┘
```

No audio data ever touches the server. The signaling layer only exchanges two small JSON payloads (SDP + ICE candidates, each ~5–10 KB).

---

## Component Analysis

### 1. Signaling Layer

WebRTC requires an out-of-band channel to exchange SDP offers/answers and ICE candidates before a P2P connection can be established. This project runs on Netlify, which provides **serverless functions only** — no persistent WebSocket connections.

**Approach: REST polling over Netlify Blobs**

Netlify Blobs is a key-value store available natively inside Netlify Functions with per-key TTL support. It requires no additional infrastructure or third-party service — the platform already provides it.

Signal flow:
1. Sender gathers all ICE candidates locally (waits for `iceGatheringState === 'complete'`), then POSTs a single payload `{ sdp, candidates[] }` to `/api/signal?room=X7K9MQ&role=offer`.
2. Sender polls GET `/api/signal?room=X7K9MQ&role=answer` every 500 ms waiting for the receiver.
3. Receiver GETs offer, creates answer + gathers its own ICE, POSTs `{ sdp, candidates[] }` to `/api/signal?room=X7K9MQ&role=answer`.
4. Sender's next poll returns the answer → both sides call `setRemoteDescription` → P2P connection is live.

Waiting for full ICE gathering before posting ("non-trickle" ICE) adds 1–2 s to connection setup but eliminates the need for real-time signaling, making the polling approach practical.

**Why not alternatives:**

| Option | Problem |
|---|---|
| PeerJS hosted server | External dependency, availability risk, rate limits |
| Pusher / Ably | Requires API keys, another paid service |
| WebSockets on Netlify | Not supported in serverless functions |
| Netlify Blobs polling | ✅ No external dependency, built into the platform, TTL prevents stale data |

### 2. WebRTC Layer

Use the native browser `RTCPeerConnection` API directly — no library needed.

```
ICE servers:
  Primary:  stun:stun.l.google.com:19302   (free, high availability)
  Fallback: stun:stun1.l.google.com:19302

TURN: Not included in MVP.
      Needed only for symmetric-NAT networks (~15% of cases).
      Can be added later via Twilio TURN (free tier: 10 GB/month).
```

**Sender side:**
```js
const pc = new RTCPeerConnection({ iceServers })
const dc = pc.createDataChannel('files')
const offer = await pc.createOffer()
await pc.setLocalDescription(offer)
// Wait for full ICE gathering
await new Promise(resolve => {
  if (pc.iceGatheringState === 'complete') return resolve()
  pc.addEventListener('icegatheringstatechange', () => {
    if (pc.iceGatheringState === 'complete') resolve()
  })
})
// pc.localDescription now contains offer + all candidates
```

**Receiver side:**
```js
const pc = new RTCPeerConnection({ iceServers })
pc.addEventListener('datachannel', e => receiveFiles(e.channel))
await pc.setRemoteDescription(offerSdp)
// Add remote ICE candidates
for (const c of offerCandidates) await pc.addIceCandidate(c)
const answer = await pc.createAnswer()
await pc.setLocalDescription(answer)
// Wait for ICE gathering, then post answer
```

### 3. File Transfer Protocol

`RTCDataChannel` has a practical per-message limit of **64 KB** across all browsers. Files are chunked and sent with alternating control (JSON string) and binary (ArrayBuffer) messages on a single channel — the receiver distinguishes them by type.

```
Message sequence on the DataChannel:

  Sender → Receiver
  ─────────────────
  { type: 'MANIFEST', files: [{ id, name, size }] }

  for each file:
    { type: 'FILE_START', id, name, size, totalChunks }
    <ArrayBuffer chunk 0>
    <ArrayBuffer chunk 1>
    ... (64 KB each)
    { type: 'FILE_END', id }

  { type: 'ALL_DONE' }
```

**Backpressure:** Before sending each chunk, check `dataChannel.bufferedAmount`. If it exceeds 2 MB, wait 50 ms and retry. This prevents memory exhaustion on slow connections.

**Transfer time estimates (64 KB chunks):**

| File size | 1 Mbps (mobile) | 5 Mbps (WiFi) | 20 Mbps (fast WiFi) |
|---|---|---|---|
| 5 MB (1 song) | ~40 s | ~8 s | ~2 s |
| 25 MB (5 songs) | ~3 min | ~40 s | ~10 s |

Progress is reported per-chunk so both sides can show a live progress bar.

### 4. Room Code and Share URL

```
Room ID:   6 characters, alphanumeric uppercase  (e.g. X7K9MQ)
Alphabet:  A-Z + 2-9  (no 0/O/1/I ambiguity)
Entropy:   32^6 ≈ 1 billion combinations — collision risk negligible
TTL:       5 minutes (Netlify Blobs key expiry)

Share URL: https://killing-freud.netlify.app/?demo-share=X7K9MQ
```

The receiver detects the `?demo-share=` parameter on page load and enters the incoming session flow automatically.

### 5. QR Code

Generated entirely client-side using the [`qrcode`](https://github.com/soldair/node-qrcode) npm package (~31 KB gzipped). No server round-trip or external API call.

```js
import QRCode from 'qrcode'
await QRCode.toCanvas(canvasEl, shareUrl, { width: 220, color: { dark: '#e8e8e8', light: '#111111' } })
```

The dark/light inversion matches the site's dark theme.

---

## Data Flow Diagrams

### Sender Flow

```
[DEMO mode active]
       │
       ▼
  Tap "Share" button in demo banner
       │
       ▼
  Generate room ID (crypto.randomUUID trimmed → 6 chars)
  Create RTCPeerConnection + DataChannel
  Create SDP offer, wait for ICE gathering
       │
       ▼
  POST /api/signal  { room, role:'offer', sdp, candidates }
  → Netlify Blobs: set `X7K9MQ/offer` (TTL 5 min)
       │
       ▼
  Show Share Modal:
  ┌──────────────────────────────┐
  │  ██████  Share DEMO Session  │
  │  ██  ██  ─────────────────   │
  │  ██████  [QR code here]      │
  │          ─────────────────   │
  │  killing-freud.app/?demo-    │
  │  share=X7K9MQ  [Copy]        │
  │                              │
  │  ◌ Waiting for connection…   │
  └──────────────────────────────┘
       │
       │  (polling GET /api/signal?room=X7K9MQ&role=answer every 500ms)
       │
       ▼ answer arrives
  setRemoteDescription(answer.sdp)
  addIceCandidate(answer.candidates[])
       │
       ▼
  DataChannel 'open' event
       │
       ▼
  Send MANIFEST → send FILE_START + chunks → FILE_END → ALL_DONE
       │
       ▼
  Modal: "Transfer complete ✓"
```

### Receiver Flow

```
  Opens URL: killing-freud.netlify.app/?demo-share=X7K9MQ
       │
       ▼
  main.js detects ?demo-share param
       │
       ▼
  Show "Incoming Session" overlay:
  ┌──────────────────────────────┐
  │  Incoming DEMO session       │
  │  X7K9MQ                      │
  │                              │
  │  [Accept]   [Decline]        │
  └──────────────────────────────┘
       │  Accept clicked
       ▼
  GET /api/signal?room=X7K9MQ&role=offer
  → RTCPeerConnection created
  → setRemoteDescription(offer.sdp)
  → addIceCandidate(offer.candidates[])
  → createAnswer + wait ICE gathering
       │
       ▼
  POST /api/signal { room, role:'answer', sdp, candidates }
       │
       ▼
  DataChannel 'open' (triggered by sender completing setRemoteDescription)
       │
       ▼
  Receive MANIFEST — know how many files/bytes are coming
  Receive FILE_START + chunks → reassemble → Blob
  Show progress bar (bytes received / total bytes)
       │
       ▼
  ALL_DONE received
  → Save all Blobs to IndexedDB demo-tracks (same as DemoMode.enter())
  → Set localStorage kf_demo_active + kf_demo_track_ids
  → location.reload()  →  DEMO mode active with received files
```

---

## New Files

### `netlify/functions/signal.js`
REST endpoint for signaling.

```
GET  /api/signal?room=X7K9MQ&role=offer   → returns { sdp, candidates } or 404
POST /api/signal?room=X7K9MQ&role=offer   → stores payload, returns 200
GET  /api/signal?room=X7K9MQ&role=answer  → returns { sdp, candidates } or 404
POST /api/signal?room=X7K9MQ&role=answer  → stores payload, returns 200
```

Uses `@netlify/blobs` (available in the Netlify Functions runtime without installation):
```js
const { getStore } = require('@netlify/blobs')
const store = getStore('webrtc-signals')
await store.set(`${room}/${role}`, JSON.stringify(body), { ttl: 300 })
const data = await store.get(`${room}/${role}`, { type: 'json' })
```

Security: the room ID acts as an unguessable shared secret (1 billion combinations, 5-min TTL).

### `src/js/demo-share.js`
Core WebRTC + signaling + file transfer logic.

- `DemoShare` class
  - `startAsHost(tracks)` → generates room ID, posts offer, returns `{ roomId, shareUrl }`
  - `connect(roomId)` → joins as receiver, returns a promise that resolves when the DataChannel is open
  - `sendFiles(files)` → sends MANIFEST + chunks + control frames; calls progress callback
  - `onProgress(cb)` / `onComplete(cb)` / `onError(cb)` — event hooks
  - Internal: `_waitForIce()`, `_pollForSignal(room, role)`, `_postSignal(room, role, payload)`

### `src/js/demo-share-ui.js`
UI layer — decoupled from WebRTC logic.

- `initShareButton(tracks)` — adds "Share" button to the demo banner; shown only in demo mode
- `showShareModal(roomId, shareUrl)` — renders QR code, copy URL button, status text, progress bar
- `showIncomingSession(roomId)` — overlay for receiver: "Accept / Decline" buttons
- `updateTransferProgress(received, total)` — live progress during transfer

### `src/js/qr.js`
Thin wrapper around the `qrcode` library.

- `renderQR(canvasEl, url)` → renders a dark-theme QR code into a `<canvas>` element

---

## Modified Files

### `src/index.html`
- Share modal (hidden by default): QR `<canvas>`, URL display with copy button, status line, progress bar
- Incoming session overlay (hidden by default): room code display, Accept / Decline buttons

### `src/js/main.js`
- On load: detect `?demo-share=ROOM` query param → if found, show incoming session overlay
- In demo mode: call `initShareButton(tracks)` after player loads tracks

### `src/js/player.js`
- After `init(demoTracks)` completes in demo mode, expose `this.tracks` so `main.js` can pass them to `initShareButton`

### `src/styles.css`
- Share modal styles (matches existing dark aesthetic)
- Incoming session overlay styles
- QR code container styles
- Transfer progress bar styles
- Share button in demo banner

### `package.json`
- Add `"qrcode": "^1.5.4"` to `dependencies`
- `@netlify/blobs` is built into the Netlify Functions runtime; no package.json entry needed for deployment, but add as devDependency for local type checking

---

## Dependency Analysis

| Package | Purpose | Size | Install required |
|---|---|---|---|
| `qrcode` | Client-side QR canvas rendering | ~31 KB gzipped | Yes (`npm install qrcode`) |
| `@netlify/blobs` | KV storage in Netlify Function | N/A (runtime built-in) | As devDep for local types |

No WebRTC library is needed — native browser API is sufficient and is available in all modern browsers.

---

## Security Considerations

| Risk | Mitigation |
|---|---|
| Room ID guessing | 32^6 ≈ 1B combinations + 5-min TTL makes brute force impractical |
| Eavesdropping on transfer | WebRTC DataChannels are DTLS-encrypted end-to-end by spec |
| Replay attack (reusing a room) | Blobs are deleted or TTL-expired; receiver's answer overwrites any stale value |
| Malicious file injection | Files come only from the peer who created the room; receiver controls acceptance |
| Stale signals polluting Blobs | 5-min TTL auto-expires all keys |

Add a user-visible warning in the share modal: "Only share this code with people you trust."

---

## TURN Server Consideration

**Why it matters:** ~15–20% of users are behind symmetric NAT (common on corporate VPNs and some mobile carriers). These users cannot establish direct P2P connections without a TURN relay server.

**MVP:** Ship with STUN only. The connection attempt will silently fail for those users.

**Phase 2 option — Twilio TURN (free tier: 10 GB/mo):**
```js
// Fetch Twilio ephemeral credentials from a new Netlify Function
const { username, credential, uris } = await fetch('/api/turn-credentials').then(r => r.json())
const pc = new RTCPeerConnection({
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: uris, username, credential }
  ]
})
```
This would require a `TWILIO_ACCOUNT_SID` + `TWILIO_AUTH_TOKEN` env var and a new Netlify Function `turn-credentials.js`.

---

## Implementation Phases

### Phase 1 — MVP (P2P transfer on good networks)
- `netlify/functions/signal.js` with Netlify Blobs
- `src/js/demo-share.js` — host + join + file transfer
- `src/js/demo-share-ui.js` — share modal with QR + incoming overlay
- `src/js/qr.js` wrapper
- Share button in demo banner
- `?demo-share=` detection in `main.js`
- STUN-only ICE

### Phase 2 — Robustness
- TURN server credentials endpoint (Twilio or coturn)
- Trickle ICE via SSE or short-poll (reduces connection time from ~5 s to ~1 s)
- Transfer cancellation (`ABORT` frame)
- Retry on DataChannel error
- Sender can push multiple drop sessions without reloading (replace tracks in existing room)

### Phase 3 — UX Polish
- Animated QR code scan hint
- Sound/haptic on connection established
- Estimated time remaining during transfer
- Deep-link that pre-scrolls receiver to the music section after entering demo mode

---

## Files Summary

| File | Change | Purpose |
|---|---|---|
| `netlify/functions/signal.js` | **New** | REST signaling via Netlify Blobs |
| `src/js/demo-share.js` | **New** | WebRTC, signaling client, file transfer |
| `src/js/demo-share-ui.js` | **New** | Share modal, incoming overlay, progress |
| `src/js/qr.js` | **New** | QR code rendering wrapper |
| `src/index.html` | **Modify** | Share modal + incoming session elements |
| `src/js/main.js` | **Modify** | `?demo-share=` detection, initShareButton |
| `src/js/player.js` | **Modify** | Expose tracks after demo init |
| `src/styles.css` | **Modify** | Share modal, overlay, QR, progress styles |
| `package.json` | **Modify** | Add `qrcode` dependency |
