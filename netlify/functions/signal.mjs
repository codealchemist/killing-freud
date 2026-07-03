/**
 * Netlify Function v2: signal
 * GET  /api/signal?room=XXXX&role=offer|answer  → fetch SDP payload
 * POST /api/signal?room=XXXX&role=offer|answer  → store SDP payload
 *
 * Uses @netlify/blobs with context passed from the v2 handler.
 * Entries are deleted after being read — single-use implicit cleanup.
 */

import { getStore } from '@netlify/blobs'

const VALID_ROLES = new Set(['offer', 'answer'])

function respond(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store'
    }
  })
}

export default async function handler(request, context) {
  const url = new URL(request.url)
  const room = (url.searchParams.get('room') ?? '').toUpperCase()
  const role = url.searchParams.get('role') ?? ''

  if (!room || !role)
    return respond({ error: 'Missing room or role' }, 400)

  if (!VALID_ROLES.has(role))
    return respond({ error: 'role must be offer or answer' }, 400)

  if (!/^[A-Z0-9]{4,16}$/.test(room))
    return respond({ error: 'Invalid room ID' }, 400)

  let store
  try {
    store = getStore({ name: 'webrtc-signals', context })
  } catch (err) {
    console.error('signal: getStore failed', err.message)
    return respond({ error: 'Storage unavailable' }, 503)
  }

  const key = `${room}/${role}`

  if (request.method === 'POST') {
    let body
    try {
      body = await request.json()
    } catch {
      return respond({ error: 'Invalid JSON' }, 400)
    }
    try {
      await store.set(key, JSON.stringify(body))
      return respond({ ok: true })
    } catch (err) {
      console.error('signal: set failed', err.message)
      return respond({ error: 'Failed to store signal' }, 500)
    }
  }

  if (request.method === 'GET') {
    try {
      // Strong consistency ensures a write is visible immediately on read,
      // which matters when sender and receiver hit different edge nodes.
      const raw = await store.get(key, { consistency: 'strong' })
      if (raw == null)
        return respond({ error: 'Not found' }, 404)

      const data = JSON.parse(raw)

      // Single-use: clean up after the peer reads it (fire and forget)
      store.delete(key).catch(e => console.warn('signal: delete failed', e.message))

      return respond(data)
    } catch (err) {
      console.error('signal: get failed', err.message)
      return respond({ error: 'Failed to retrieve signal' }, 500)
    }
  }

  return new Response('Method Not Allowed', { status: 405 })
}
