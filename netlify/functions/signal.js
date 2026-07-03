/**
 * Netlify Function: signal
 * GET  /api/signal?room=XXXX&role=offer|answer  → fetch SDP payload
 * POST /api/signal?room=XXXX&role=offer|answer  → store SDP payload (TTL 5 min)
 *
 * Used as the signaling channel for WebRTC DEMO share sessions.
 * Audio data travels P2P; only small SDP + ICE payloads pass through here.
 */

const { getStore } = require('@netlify/blobs')

const VALID_ROLES = new Set(['offer', 'answer'])
const TTL = 300 // 5 minutes

exports.handler = async function (event) {
  const { room, role } = event.queryStringParameters || {}

  if (!room || !role)
    return { statusCode: 400, body: JSON.stringify({ error: 'Missing room or role' }), headers: { 'Content-Type': 'application/json' } }

  if (!VALID_ROLES.has(role))
    return { statusCode: 400, body: JSON.stringify({ error: 'role must be offer or answer' }), headers: { 'Content-Type': 'application/json' } }

  // Sanitise room ID: alphanumeric only, max 16 chars
  if (!/^[A-Z0-9]{4,16}$/i.test(room))
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid room ID' }), headers: { 'Content-Type': 'application/json' } }

  const store = getStore('webrtc-signals')
  const key = `${room.toUpperCase()}/${role}`

  if (event.httpMethod === 'POST') {
    let body
    try {
      body = JSON.parse(event.body)
    } catch {
      return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON' }), headers: { 'Content-Type': 'application/json' } }
    }

    await store.setJSON(key, body, { ttl: TTL })
    return { statusCode: 200, body: JSON.stringify({ ok: true }), headers: { 'Content-Type': 'application/json' } }
  }

  if (event.httpMethod === 'GET') {
    const data = await store.get(key, { type: 'json' })
    if (data == null)
      return { statusCode: 404, body: JSON.stringify({ error: 'Not found' }), headers: { 'Content-Type': 'application/json' } }

    return {
      statusCode: 200,
      body: JSON.stringify(data),
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
    }
  }

  return { statusCode: 405, body: 'Method Not Allowed' }
}
