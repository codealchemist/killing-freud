import { saveDemoTrack, getAllDemoTracks, clearDemoTracks } from './offline-storage.js'

const ACTIVE_KEY = 'kf_demo_active'
const IDS_KEY = 'kf_demo_track_ids'
const ALBUM_KEY = 'kf_demo_album'

export function isActive() {
  return localStorage.getItem(ACTIVE_KEY) === 'true'
}

export function getAlbumName() {
  return localStorage.getItem(ALBUM_KEY) || 'DEMO'
}

export async function enter(files, albumName = 'DEMO') {
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
  location.reload()
}

export async function exit() {
  await clearDemoTracks()
  localStorage.removeItem(ACTIVE_KEY)
  localStorage.removeItem(IDS_KEY)
  localStorage.removeItem(ALBUM_KEY)
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
