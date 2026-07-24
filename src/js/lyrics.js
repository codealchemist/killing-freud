// Lyrics txt format:
//   Line 1  — song title
//   Line 2  — blank
//   Line 3+ — lyrics body (blank lines separate stanzas)
//
// Files live under src/lyrics/<album-slug>/*.txt so each album's lyrics stay
// grouped, even though they're all bundled at build time via one glob.

const rawFiles = import.meta.glob('../lyrics/**/*.txt', {
  eager: true,
  query: '?raw',
  import: 'default',
})

function parse(raw) {
  const lines = raw.replace(/\r\n/g, '\n').split('\n')
  const title = lines[0].trim()
  // Everything after the first blank line is the body
  const bodyStart = lines.findIndex((l, i) => i > 0 && l.trim() === '') + 1
  const body = lines.slice(bodyStart).join('\n').trim()
  // Split into stanzas on blank lines
  const stanzas = body.split(/\n{2,}/).map(s => s.trim()).filter(Boolean)
  return { title, stanzas }
}

// path looks like '../lyrics/<slug>/<file>.txt' — the slug is the folder name.
function slugFromPath(path) {
  const parts = path.split('/')
  return parts.length >= 3 ? parts[parts.length - 2] : null
}

const entriesBySlug = new Map()
for (const [path, text] of Object.entries(rawFiles)) {
  const slug = slugFromPath(path)
  if (!slug) continue
  if (!entriesBySlug.has(slug)) entriesBySlug.set(slug, [])
  entriesBySlug.get(slug).push({ path, ...parse(text) })
}
for (const list of entriesBySlug.values()) {
  list.sort((a, b) => a.path.localeCompare(b.path))
}

// Renders `slug`'s lyrics into the given nav/display elements. Called each
// time the Lyrics tab is activated for an album — cheap (already bundled),
// so no caching needed beyond the module-level parse done once above.
export function renderLyricsForAlbum(slug, { navEl, displayEl }) {
  const entries = entriesBySlug.get(slug) || []
  if (!navEl || !displayEl) return

  navEl.innerHTML = ''
  displayEl.innerHTML = ''
  if (!entries.length) return

  function show(index) {
    navEl.querySelectorAll('.lyrics-nav__btn').forEach((btn, i) =>
      btn.classList.toggle('is-active', i === index)
    )
    const { title, stanzas } = entries[index]
    displayEl.innerHTML = `
      <h3 class="lyrics__title">${title}</h3>
      ${stanzas.map(s =>
        `<p class="lyrics__stanza">${s.replace(/\n/g, '<br>')}</p>`
      ).join('')}
    `
  }

  entries.forEach((lyric, i) => {
    const btn = document.createElement('button')
    btn.className = 'lyrics-nav__btn'
    btn.textContent = lyric.title
    btn.addEventListener('click', () => show(i))
    navEl.appendChild(btn)
  })

  show(0)
}
