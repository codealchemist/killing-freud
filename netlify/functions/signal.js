/**
 * Netlify Function: signal
 * GET  /api/signal?room=XXXX&role=offer|answer  → fetch SDP payload
 * POST /api/signal?room=XXXX&role=offer|answer  → store SDP payload
 *
 * Used as the signaling channel for WebRTC DEMO share sessions.
 * Audio data travels P2P; only small SDP + ICE payloads pass through here.
 * Entries are deleted after being read (single-use, implicit cleanup).
 */

const { getStore } = require('@netlify/blobs')

const VALID_ROLES = new Set(['offer', 'answer'])

function json(statusCode, body, extra = {}) {
  return {
    statusCode,
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json', ...extra }
  }
}

exports.handler = async function (event) {
  const { room, role } = event.queryStringParameters || {}

  if (!room || !role)
    return json(400, { error: 'Missing room or role' })

  if (!VALID_ROLES.has(role))
    return json(400, { error: 'role must be offer or answer' })

  if (!/^[A-Z0-9]{4,16}$/i.test(room))
    return json(400, { error: 'Invalid room ID' })

  let store
  try {
    store = getStore('webrtc-signals')
  } catch (err) {
    console.error('Blobs init error:', err.message)
    return json(503, { error: 'Signaling storage unavailable. Ensure Netlify Blobs is enabled for this site.' })
  }

  const key = `${room.toUpperCase()}/${role}`

  if (event.httpMethod === 'POST') {
    let body
    try {
      body = JSON.parse(event.body)
    } catch {
      return json(400, { error: 'Invalid JSON' })
    }
    try {
      await store.set(key, JSON.stringify(body))
      return json(200, { ok: true })
    } catch (err) {
      console.error('Blobs set error:', err.message)
      return json(500, { error: 'Failed to store signal' })
    }
  }

  if (event.httpMethod === 'GET') {
    try {
      const result = await store.get(key, { type: 'json' })
      if (result == null)
        return json(404, { error: 'Not found' })

      // Single-use: delete after the receiver/host reads it
      store.delete(key).catch(() => {})

      return json(200, result.data, { 'Cache-Control': 'no-store' })
    } catch (err) {
      console.error('Blobs get error:', err.message)
      return json(500, { error: 'Failed to retrieve signal' })
    }
  }

  return { statusCode: 405, body: 'Method Not Allowed' }
}
