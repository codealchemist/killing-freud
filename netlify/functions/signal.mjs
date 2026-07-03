/**
 * Netlify Function v2: signal
 * GET  /api/signal?room=XXXX&role=offer|answer  → fetch SDP payload
 * POST /api/signal?room=XXXX&role=offer|answer  → store SDP payload
 *
 * Uses @netlify/blobs with context passed from the v2 handler — this is
 * the only way to get Blobs working without manual siteID/token config.
 * Entries are deleted after being read — single-use implicit cleanup.
 */

import { getStore } from '@netlify/blobs'

const VALID_ROLES = new Set(['offer', 'answer'])

function json(data, status = 200, extra = {}) {
  return Response.json(data, {
    status,
    headers: { 'Cache-Control': 'no-store', ...extra }
  })
}

export default async function handler(request, context) {
  const url = new URL(request.url)
  const room = url.searchParams.get('room')
  const role = url.searchParams.get('role')

  if (!room || !role)
    return json({ error: 'Missing room or role' }, 400)

  if (!VALID_ROLES.has(role))
    return json({ error: 'role must be offer or answer' }, 400)

  if (!/^[A-Z0-9]{4,16}$/i.test(room))
    return json({ error: 'Invalid room ID' }, 400)

  const store = getStore({ name: 'webrtc-signals', context })
  const key = `${room.toUpperCase()}/${role}`

  if (request.method === 'POST') {
    let body
    try {
      body = await request.json()
    } catch {
      return json({ error: 'Invalid JSON' }, 400)
    }
    try {
      await store.set(key, JSON.stringify(body))
      return json({ ok: true })
    } catch (err) {
      console.error('signal: set failed', err.message)
      return json({ error: 'Failed to store signal' }, 500)
    }
  }

  if (request.method === 'GET') {
    try {
      const result = await store.get(key, { type: 'json' })
      if (result == null)
        return json({ error: 'Not found' }, 404)

      // Single-use: clean up after the peer reads it
      store.delete(key).catch(() => {})

      return json(result)
    } catch (err) {
      console.error('signal: get failed', err.message)
      return json({ error: 'Failed to retrieve signal' }, 500)
    }
  }

  return new Response('Method Not Allowed', { status: 405 })
}
