// Lyrics txt format:
//   Line 1  — song title
//   Line 2  — blank
//   Line 3+ — lyrics body (blank lines separate stanzas)

const rawFiles = import.meta.glob('../lyrics/*.txt', {
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

export function initLyrics() {
  const entries = Object.entries(rawFiles)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([, text]) => parse(text))

  if (!entries.length) return

  const section    = document.getElementById('lyrics')
  const navEl      = document.getElementById('lyricsNav')
  const displayEl  = document.getElementById('lyricsDisplay')
  if (!section || !navEl || !displayEl) return

  section.hidden = false

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
