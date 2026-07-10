import {
  open,
  txOn,
  MULTITRACK_SESSIONS_STORE,
  MULTITRACK_TRACKS_STORE,
  MULTITRACK_TRACKS_SESSION_INDEX
} from './offline-storage.js'

// ─── Sessions ───────────────────────────────────────────────

export async function createSession(name) {
  const db = await open()
  const session = {
    id: crypto.randomUUID(),
    name: name || 'Untitled Session',
    trackOrder: [],
    trackState: {},
    createdAt: Date.now(),
    updatedAt: Date.now()
  }
  await txOn(db, MULTITRACK_SESSIONS_STORE, 'readwrite', store => {
    store.put(session)
  })
  return session
}

export async function listSessions() {
  const db = await open()
  return new Promise((resolve, reject) => {
    const req = db
      .transaction(MULTITRACK_SESSIONS_STORE)
      .objectStore(MULTITRACK_SESSIONS_STORE)
      .getAll()
    req.onsuccess = e => resolve(e.target.result.sort((a, b) => b.updatedAt - a.updatedAt))
    req.onerror = e => reject(e.target.error)
  })
}

export async function getSession(id) {
  const db = await open()
  return new Promise((resolve, reject) => {
    const req = db
      .transaction(MULTITRACK_SESSIONS_STORE)
      .objectStore(MULTITRACK_SESSIONS_STORE)
      .get(id)
    req.onsuccess = e => resolve(e.target.result ?? null)
    req.onerror = e => reject(e.target.error)
  })
}

async function putSession(session) {
  const db = await open()
  session.updatedAt = Date.now()
  await txOn(db, MULTITRACK_SESSIONS_STORE, 'readwrite', store => {
    store.put(session)
  })
  return session
}

export async function renameSession(id, name) {
  const session = await getSession(id)
  if (!session) return null
  session.name = name || session.name
  return putSession(session)
}

export async function deleteSession(id) {
  const db = await open()
  const trackIds = await new Promise((resolve, reject) => {
    const req = db
      .transaction(MULTITRACK_TRACKS_STORE)
      .objectStore(MULTITRACK_TRACKS_STORE)
      .index(MULTITRACK_TRACKS_SESSION_INDEX)
      .getAllKeys(id)
    req.onsuccess = e => resolve(e.target.result)
    req.onerror = e => reject(e.target.error)
  })

  await txOn(db, MULTITRACK_TRACKS_STORE, 'readwrite', store => {
    trackIds.forEach(trackId => store.delete(trackId))
  })
  await txOn(db, MULTITRACK_SESSIONS_STORE, 'readwrite', store => {
    store.delete(id)
  })
}

// ─── Tracks ─────────────────────────────────────────────────

export async function addTracksToSession(sessionId, files) {
  const session = await getSession(sessionId)
  if (!session) throw new Error(`Session not found: ${sessionId}`)

  const db = await open()
  const newTracks = Array.from(files).map(file => ({
    id: crypto.randomUUID(),
    sessionId,
    name: file.name,
    size: file.size,
    blob: file,
    addedAt: Date.now()
  }))

  await txOn(db, MULTITRACK_TRACKS_STORE, 'readwrite', store => {
    newTracks.forEach(track => store.put(track))
  })

  session.trackOrder = [...session.trackOrder, ...newTracks.map(t => t.id)]
  newTracks.forEach(t => {
    // All tracks are selected (soloed) by default — trackswitch treats "no
    // track soloed" as silence when exclusiveSolo is off, so this is what
    // makes a freshly dropped session audible without the user toggling
    // every track on individually.
    session.trackState[t.id] = { volume: 1, pan: 0, solo: true }
  })
  await putSession(session)

  return { session, tracks: newTracks }
}

export async function removeTrackFromSession(sessionId, trackId) {
  const session = await getSession(sessionId)
  if (!session) return null

  const db = await open()
  await txOn(db, MULTITRACK_TRACKS_STORE, 'readwrite', store => {
    store.delete(trackId)
  })

  session.trackOrder = session.trackOrder.filter(id => id !== trackId)
  delete session.trackState[trackId]
  return putSession(session)
}

export async function getSessionTracks(sessionId) {
  const db = await open()
  const all = await new Promise((resolve, reject) => {
    const req = db
      .transaction(MULTITRACK_TRACKS_STORE)
      .objectStore(MULTITRACK_TRACKS_STORE)
      .index(MULTITRACK_TRACKS_SESSION_INDEX)
      .getAll(sessionId)
    req.onsuccess = e => resolve(e.target.result)
    req.onerror = e => reject(e.target.error)
  })

  const session = await getSession(sessionId)
  const byId = new Map(all.map(t => [t.id, t]))
  const order = session?.trackOrder ?? all.map(t => t.id)

  return order
    .map(id => byId.get(id))
    .filter(Boolean)
    .map(t => ({ ...t, state: session?.trackState?.[t.id] ?? { volume: 1, pan: 0, solo: true } }))
}

export async function updateTrackState(sessionId, trackId, state) {
  const session = await getSession(sessionId)
  if (!session) return null
  session.trackState[trackId] = { ...session.trackState[trackId], ...state }
  return putSession(session)
}

// ─── Import (receiver side of a shared session) ────────────

// `metadata.trackState` is an array positionally aligned with `files` — the
// sender's track ids don't survive the transfer, since each received blob is
// saved under a freshly generated local id, so state is matched by index.
export async function importSession(name, files, metadata) {
  const session = await createSession(name || 'Shared Session')
  const { tracks: newTracks } = await addTracksToSession(session.id, files)

  if (metadata?.trackState) {
    for (let i = 0; i < newTracks.length; i++) {
      const state = metadata.trackState[i]
      if (state) await updateTrackState(session.id, newTracks[i].id, state)
    }
  }

  return getSession(session.id)
}

