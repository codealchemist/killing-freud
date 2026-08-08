import { saveDemoTrack, getAllDemoTracks, clearDemoTracks } from './offline-storage.js'

const ACTIVE_KEY      = 'kf_demo_active'
const IDS_KEY         = 'kf_demo_track_ids'
const ALBUM_KEY       = 'kf_demo_album'
const ART_KEY         = 'kf_demo_art'
const RECEIVED_KEY    = 'kf_demo_received'
const SHARE_COUNT_KEY = 'kf_demo_share_count'

export function isActive() {
  return localStorage.getItem(ACTIVE_KEY) === 'true'
}

export function getAlbumName() {
  return localStorage.getItem(ALBUM_KEY) || 'DEMO'
}

export function getAlbumArt() {
  return localStorage.getItem(ART_KEY) || null
}

export function setAlbumName(name) {
  localStorage.setItem(ALBUM_KEY, name || 'DEMO')
}

export function setAlbumArt(dataUrl) {
  if (dataUrl) localStorage.setItem(ART_KEY, dataUrl)
  else localStorage.removeItem(ART_KEY)
}

export function isReceived() {
  return localStorage.getItem(RECEIVED_KEY) === 'true'
}

// Lifetime count of completed demo-session shares — survives exiting/
// re-entering demo mode, since it's a running tally, not per-session state.
export function getShareCount() {
  return parseInt(localStorage.getItem(SHARE_COUNT_KEY) || '0', 10)
}

export function incrementShareCount() {
  const next = getShareCount() + 1
  localStorage.setItem(SHARE_COUNT_KEY, String(next))
  return next
}

export async function enter(files, albumName = 'DEMO', received = false, albumArt = null) {
  await clearDemoTracks()

  const ids = []
  for (const file of files) {
    const id = crypto.randomUUID()
    await saveDemoTrack({ id, name: file.name, size: file.size, blob: file })
    ids.push(id)
  }

  localStorage.setItem(ACTIVE_KEY, 'true')
  localStorage.setItem(IDS_KEY, JSON.stringify(ids))
  localStorage.setItem(ALBUM_KEY, albumName)
  localStorage.setItem(RECEIVED_KEY, received ? 'true' : 'false')
  if (albumArt) localStorage.setItem(ART_KEY, albumArt)
  else localStorage.removeItem(ART_KEY)
  location.reload()
}

export async function exit() {
  await clearDemoTracks()
  localStorage.removeItem(ACTIVE_KEY)
  localStorage.removeItem(IDS_KEY)
  localStorage.removeItem(ALBUM_KEY)
  localStorage.removeItem(ART_KEY)
  localStorage.removeItem(RECEIVED_KEY)
  location.reload()
}

export async function getTracks() {
  const idsRaw = localStorage.getItem(IDS_KEY)
  if (!idsRaw) return []

  const ids = JSON.parse(idsRaw)
  const all = await getAllDemoTracks()
  const byId = new Map(all.map(t => [t.id, t]))

  return ids
    .map(id => byId.get(id))
    .filter(Boolean)
    .map(t => ({
      id: t.id,
      name: t.name,
      size: t.size,
      blob: t.blob,
      url: null,
      offlineState: 'demo',
      _cacheKey: null
    }))
}
