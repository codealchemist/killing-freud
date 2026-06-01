import { saveTrack, getTrack, removeTrack, getAllCached, clearAll } from './offline-storage.js'

export { removeTrack as deleteTrack, clearAll }

export async function downloadTrack(track, onProgress) {
  const res = await fetch(track.url)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)

  const total = parseInt(res.headers.get('content-length') || '0', 10)
  const reader = res.body.getReader()
  const chunks = []
  let received = 0

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(value)
    received += value.length
    if (total > 0) onProgress?.(received / total)
  }

  const blob = new Blob(chunks, { type: 'audio/mpeg' })
  await saveTrack(track, blob)
  return blob
}

export async function getTrackBlob(id) {
  const rec = await getTrack(id)
  return rec?.blob ?? null
}

export async function getCachedMap() {
  const all = await getAllCached()
  return new Map(all.map(({ id, name, size, savedAt }) => [id, { id, name, size, savedAt }]))
}

// Compares server tracks against what's in IndexedDB.
// Same name + different id  → update available (file was re-uploaded to Cloudinary)
// Cached id not on server   → offline-only (removed or renamed on server, keep locally)
export function diffTracks(serverTracks, cachedMap) {
  const fresh = [], cached = [], updates = []
  const matched = new Set()

  for (const s of serverTracks) {
    if (cachedMap.has(s.id)) {
      cached.push(s)
      matched.add(s.id)
    } else {
      const match = [...cachedMap.values()].find(c => c.name === s.name)
      if (match) {
        updates.push({ server: s, cachedId: match.id })
        matched.add(match.id)
      } else {
        fresh.push(s)
      }
    }
  }

  const offlineOnly = [...cachedMap.values()].filter(c => !matched.has(c.id))
  return { fresh, cached, updates, offlineOnly }
}
