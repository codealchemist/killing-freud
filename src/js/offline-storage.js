const DB_NAME = 'killing-freud-offline'
const DB_VERSION = 1
const STORE = 'tracks'

function open() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = e => {
      if (!e.target.result.objectStoreNames.contains(STORE))
        e.target.result.createObjectStore(STORE, { keyPath: 'id' })
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
