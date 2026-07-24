function escapeHtml(str) {
  const div = document.createElement('div')
  div.textContent = str
  return div.innerHTML
}

// Fetches the published album catalog, renders it as a grid of cards inside
// #albumGrid, and opens the shared album modal when a card is clicked.
export function initAlbumCatalog(albumModal) {
  const grid = document.getElementById('albumGrid')
  const emptyEl = document.getElementById('albumGridEmpty')
  if (!grid) return null

  let albums = []

  function renderGrid() {
    grid.querySelectorAll('.album-card').forEach(el => el.remove())

    if (!albums.length) {
      if (emptyEl) emptyEl.hidden = false
      return
    }
    if (emptyEl) emptyEl.hidden = true

    albums.forEach(album => {
      const card = document.createElement('button')
      card.type = 'button'
      card.className = 'album-card'
      card.setAttribute('aria-label', `Open ${album.title}`)
      card.innerHTML = `
        <span class="album-card__art"></span>
        <span class="album-card__title">${escapeHtml(album.title)}</span>
        ${album.subtitle ? `<span class="album-card__subtitle">${escapeHtml(album.subtitle)}</span>` : ''}
      `
      if (album.artUrl) {
        card.querySelector('.album-card__art').style.backgroundImage = `url(${JSON.stringify(album.artUrl)})`
      }
      card.addEventListener('click', () => albumModal?.open(album))
      grid.appendChild(card)
    })
  }

  const ready = fetch('/api/albums')
    .then(r => r.json())
    .catch(() => [])
    .then(list => {
      albums = Array.isArray(list) ? list : []
      renderGrid()
      return albums
    })

  // Opens the album matching `slug`, optionally landing on a specific tab —
  // used for `?album=` deep links and legacy `#lyrics`/`#sharing` bookmarks.
  async function openBySlug(slug, opts = {}) {
    await ready
    const album = albums.find(a => a.slug === slug)
    if (album) albumModal?.open(album, opts)
    return album || null
  }

  // Opens the first album exposing a given optional feature (e.g. the first
  // album with `hasLyrics`/`hasSharing`) — used by the legacy hash shim.
  async function openFirstWithFeature(feature, opts = {}) {
    await ready
    const album = albums.find(a => a[feature])
    if (album) albumModal?.open(album, opts)
    return album || null
  }

  return { ready, openBySlug, openFirstWithFeature }
}
