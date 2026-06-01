import { cleanName, formatSize } from './utils.js'

export async function initSharing() {
  let tracks = []
  try {
    const res = await fetch('/api/sharing')
    if (!res.ok) return
    tracks = await res.json()
  } catch {
    return
  }

  const section = document.getElementById('sharing')
  const listEl = document.getElementById('sharingList')
  if (!section || !listEl) return

  section.hidden = false

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
