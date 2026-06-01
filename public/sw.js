const CACHE = 'killing-freud-v1'

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(c => c.add('/')))
  self.skipWaiting()
})

self.addEventListener('activate', event => {
  event.waitUntil(
    caches
      .keys()
      .then(keys =>
        Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
      )
      .then(() => self.clients.claim())
  )
})

self.addEventListener('fetch', event => {
  const { request } = event
  if (request.method !== 'GET') return

  // Skip Cloudinary CDN — audio offline is handled by IndexedDB object URLs
  if (new URL(request.url).hostname.endsWith('cloudinary.com')) return

  // Network-first for everything else: API responses, app shell, assets.
  // On success the response is cached; on failure the cache is the fallback.
  event.respondWith(
    fetch(request)
      .then(response => {
        if (response.ok) {
          const clone = response.clone()
          caches.open(CACHE).then(c => c.put(request, clone))
        }
        return response
      })
      .catch(() => caches.match(request))
  )
})
