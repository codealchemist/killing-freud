import { cleanName, formatSize } from './utils.js'

// The whole Sharing panel's copy (title, tagline, intro) per album —
// src/albums/<slug>/sharing.html, bundled at build time the same way
// lyrics.js bundles src/lyrics/<slug>/*.txt. Authored as trusted HTML
// (band-written, not user input) and rendered via innerHTML, so the file
// owns its own markup (heading, paragraphs, links, emphasis) directly —
// see the existing fragments for the expected classes
// (.album-modal__panel-title, .sharing-tagline).
const sharingContentFiles = import.meta.glob('../albums/*/sharing.html', {
  eager: true,
  query: '?raw',
  import: 'default'
})

function slugFromPath(path) {
  const parts = path.split('/')
  return parts.length >= 3 ? parts[parts.length - 2] : null
}

const contentHtmlBySlug = new Map()
for (const [path, html] of Object.entries(sharingContentFiles)) {
  const slug = slugFromPath(path)
  if (slug) contentHtmlBySlug.set(slug, html.trim())
}

const cacheBySlug = new Map()

function render(listEl, tracks) {
  listEl.innerHTML = ''
  if (!tracks.length) {
    listEl.innerHTML = '<p class="sharing-empty">No tracks available.</p>'
    return
  }

  tracks.forEach(track => {
    const item = document.createElement('div')
    item.className = 'sharing-track'
    item.innerHTML = `
      <span class="sharing-track__name">${cleanName(track.name)}</span>
      <span class="sharing-track__size">${formatSize(track.size)}</span>
      <a class="sharing-track__btn" href="${track.downloadUrl}" download="${cleanName(track.name)}.mp3" rel="noopener">
        <svg viewBox="0 0 24 24" fill="currentColor" width="14" height="14" aria-hidden="true"><path d="M13 5v8h3l-4 5-4-5h3V5h2zm-7 14h12v-2H6v2z"/></svg>
        Download
      </a>
    `
    listEl.appendChild(item)
  })
}

const DEFAULT_CONTENT_HTML = `
  <h3 class="album-modal__panel-title">Shatter the silence</h3>
  <p class="sharing-tagline">All songs. No strings attached. Add yours!</p>
  <p>Raw, instrumental tracks — no strings attached. Use them for covers, practice, or your own take. Take the tracks. Add your voice.</p>
`

// Renders `album`'s Sharing panel: its whole copy (title/tagline/intro) from
// src/albums/<slug>/sharing.html, plus its track list into `els.listEl`.
// Called each time the Sharing tab is activated; the track list is cached
// per slug so reactivating the tab doesn't refetch Cloudinary, but the copy
// is re-applied every time since switching albums must update it.
export async function renderSharingForAlbum(album, els) {
  const { contentEl, listEl } = els
  if (contentEl) contentEl.innerHTML = contentHtmlBySlug.get(album.slug) || DEFAULT_CONTENT_HTML

  if (!listEl) return
  const slug = album.slug

  if (cacheBySlug.has(slug)) {
    render(listEl, cacheBySlug.get(slug))
    return
  }

  try {
    const res = await fetch(`/api/sharing?album=${encodeURIComponent(slug)}`)
    if (!res.ok) return
    const tracks = await res.json()
    cacheBySlug.set(slug, tracks)
    render(listEl, tracks)
  } catch {
    /* leave panel as-is on failure */
  }
}
