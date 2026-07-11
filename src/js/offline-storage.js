const DB_NAME = 'killing-freud-offline'
const DB_VERSION = 3
const STORE = 'tracks'
const DEMO_STORE = 'demo-tracks'
const MULTITRACK_SESSIONS_STORE = 'multitrack-sessions'
const MULTITRACK_TRACKS_STORE = 'multitrack-tracks'
const MULTITRACK_TRACKS_SESSION_INDEX = 'by_sessionId'

function open() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = e => {
      const db = e.target.result
      if (!db.objectStoreNames.contains(STORE))
        db.createObjectStore(STORE, { keyPath: 'id' })
      if (!db.objectStoreNames.contains(DEMO_STORE))
        db.createObjectStore(DEMO_STORE, { keyPath: 'id' })
      if (!db.objectStoreNames.contains(MULTITRACK_SESSIONS_STORE))
        db.createObjectStore(MULTITRACK_SESSIONS_STORE, { keyPath: 'id' })
      if (!db.objectStoreNames.contains(MULTITRACK_TRACKS_STORE)) {
        const store = db.createObjectStore(MULTITRACK_TRACKS_STORE, { keyPath: 'id' })
        store.createIndex(MULTITRACK_TRACKS_SESSION_INDEX, 'sessionId', { unique: false })
      }
    }
    req.onsuccess = e => resolve(e.target.result)
    req.onerror = e => reject(e.target.error)
  })
}

function tx(db, mode, fn) {
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode)
    t.onerror = e => reject(e.target.error)
    t.oncomplete = () => resolve()
    fn(t.objectStore(STORE), resolve, reject)
  })
}

function txOn(db, storeName, mode, fn) {
  return new Promise((resolve, reject) => {
    const t = db.transaction(storeName, mode)
    t.onerror = e => reject(e.target.error)
    t.oncomplete = () => resolve()
    fn(t.objectStore(storeName), resolve, reject)
  })
}

// ─── Real tracks ──────────────────────────────────────────

export async function saveTrack(meta, blob) {
  const db = await open()
  return tx(db, 'readwrite', store => {
    store.put({
      id: meta.id,
      name: meta.name,
      size: meta.size,
      blob,
      savedAt: Date.now()
    })
  })
}

export async function getTrack(id) {
  const db = await open()
  return new Promise((resolve, reject) => {
    const req = db.transaction(STORE).objectStore(STORE).get(id)
    req.onsuccess = e => resolve(e.target.result ?? null)
    req.onerror = e => reject(e.target.error)
  })
}

export async function removeTrack(id) {
  const db = await open()
  return tx(db, 'readwrite', store => {
    store.delete(id)
  })
}

export async function getAllCached() {
  const db = await open()
  return new Promise((resolve, reject) => {
    const req = db.transaction(STORE).objectStore(STORE).getAll()
    req.onsuccess = e => resolve(e.target.result)
    req.onerror = e => reject(e.target.error)
  })
}

export async function clearAll() {
  const db = await open()
  return tx(db, 'readwrite', store => {
    store.clear()
  })
}

// ─── Demo tracks ──────────────────────────────────────────

export async function saveDemoTrack(track) {
  const db = await open()
  return txOn(db, DEMO_STORE, 'readwrite', store => {
    store.put({
      id: track.id,
      name: track.name,
      size: track.size,
      blob: track.blob,
      addedAt: Date.now()
    })
  })
}

export async function getAllDemoTracks() {
  const db = await open()
  return new Promise((resolve, reject) => {
    const req = db.transaction(DEMO_STORE).objectStore(DEMO_STORE).getAll()
    req.onsuccess = e => resolve(e.target.result)
    req.onerror = e => reject(e.target.error)
  })
}

export async function clearDemoTracks() {
  const db = await open()
  return txOn(db, DEMO_STORE, 'readwrite', store => {
    store.clear()
  })
}

// ─── Shared internals (reused by multitrack-storage.js) ────

export { open, txOn, MULTITRACK_SESSIONS_STORE, MULTITRACK_TRACKS_STORE, MULTITRACK_TRACKS_SESSION_INDEX }
