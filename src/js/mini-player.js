import { formatRemaining } from './sleep-timer-ui.js'

// Persistent playback control shown once a track is active and the album
// modal is closed. One DOM node, moved between a header slot (desktop, when
// there's room) and a subheader slot (mobile, or whenever the nav would
// otherwise overflow) — never duplicated, so play state/progress never
// needs to be kept in sync across two copies.
export function initMiniPlayer({ player, albumModal, sleepTimer }) {
  const headerSlot = document.getElementById('miniPlayerHeaderSlot')
  const subheaderSlot = document.getElementById('miniPlayerSubheaderSlot')
  const subheaderEl = document.getElementById('subheader')
  const navEl = document.getElementById('nav')
  if (!headerSlot || !subheaderSlot || !subheaderEl || !navEl) return null

  const mobileMql = window.matchMedia('(max-width: 640px)')

  let currentAlbum = null
  // Whatever opts the album was last opened/loaded with (e.g. demo mode's
  // `{ editable, tracks }`) — replayed verbatim on reopen, since player.js
  // treats a missing `opts.tracks` as "fetch this slug from the network",
  // which would 404 for a synthetic album like the demo pseudo-album.
  let currentOpts = {}
  let latest = { trackName: null, index: -1, total: 0, playing: false, progress: 0 }
  let modalOpen = false
  let placement = null // 'header' | 'subheader'

  const el = document.createElement('div')
  el.className = 'mini-player'
  el.hidden = true
  el.innerHTML = `
    <button type="button" class="mini-player__info" aria-label="Open full player">
      <span class="mini-player__art" id="miniPlayerArt"></span>
      <span class="mini-player__name" id="miniPlayerName">—</span>
    </button>
    <div class="mini-player__controls">
      <button type="button" class="mini-player__btn mini-player__btn--prev" aria-label="Previous track">
        <svg viewBox="0 0 24 24" fill="currentColor"><path d="M6 6h2v12H6zm3.5 6 8.5 6V6z"/></svg>
      </button>
      <button type="button" class="mini-player__btn mini-player__btn--play" aria-label="Play / Pause">
        <svg class="icon-play" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
        <svg class="icon-pause" viewBox="0 0 24 24" fill="currentColor" style="display:none"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>
      </button>
      <button type="button" class="mini-player__btn mini-player__btn--next" aria-label="Next track">
        <svg viewBox="0 0 24 24" fill="currentColor"><path d="M6 18l8.5-6L6 6v12zM16 6h2v12h-2z"/></svg>
      </button>
    </div>
    <span class="mini-player__sleep" id="miniPlayerSleep" hidden></span>
    <div class="mini-player__progress"><div class="mini-player__progress-fill" id="miniPlayerProgressFill"></div></div>
  `

  const artEl = el.querySelector('#miniPlayerArt')
  const nameEl = el.querySelector('#miniPlayerName')
  const infoBtn = el.querySelector('.mini-player__info')
  const btnPrev = el.querySelector('.mini-player__btn--prev')
  const btnPlay = el.querySelector('.mini-player__btn--play')
  const btnNext = el.querySelector('.mini-player__btn--next')
  const progressFill = el.querySelector('#miniPlayerProgressFill')
  const sleepEl = el.querySelector('#miniPlayerSleep')

  btnPrev.addEventListener('click', () => player.prev())
  btnNext.addEventListener('click', () => player.next())
  btnPlay.addEventListener('click', () => player.togglePlay())
  infoBtn.addEventListener('click', () => {
    if (currentAlbum) albumModal?.open(currentAlbum, { ...currentOpts, tab: 'player' })
  })

  function render() {
    nameEl.textContent = latest.trackName || currentAlbum?.title || '—'
    btnPlay.querySelector('.icon-play').style.display = latest.playing ? 'none' : ''
    btnPlay.querySelector('.icon-pause').style.display = latest.playing ? '' : 'none'
    progressFill.style.width = `${latest.progress || 0}%`
  }

  function updateVisibility() {
    const active = latest.index >= 0 && Boolean(latest.trackName)
    const show = active && !modalOpen
    el.hidden = !show
    subheaderEl.hidden = !(show && placement === 'subheader')
    document.body.classList.toggle('has-subheader-player', show && placement === 'subheader')
  }

  function place(target) {
    const targetSlot = target === 'header' ? headerSlot : subheaderSlot
    if (placement !== target || el.parentElement !== targetSlot) {
      placement = target
      targetSlot.appendChild(el)
    }
    updateVisibility()
  }

  // On desktop/tablet widths, tentatively dock in the header, then check
  // whether the nav actually fits it; if not, fall back to the subheader.
  // Below the mobile breakpoint it always goes to the subheader outright.
  function evaluatePlacement() {
    if (mobileMql.matches) {
      place('subheader')
      return
    }
    place('header')
    requestAnimationFrame(() => {
      if (navEl.scrollWidth > navEl.clientWidth + 1) place('subheader')
    })
  }

  new ResizeObserver(evaluatePlacement).observe(navEl)
  mobileMql.addEventListener('change', evaluatePlacement)

  player.onChange(snapshot => {
    latest = snapshot
    render()
    updateVisibility()
  })

  // Passive indicator only — no click handler of its own. The full sleep
  // timer control (with the cancel/change-duration menu) lives in the
  // player panel; clicking anywhere in .mini-player__info already reopens
  // that view, same as it does for every other detail shown here.
  const sleepIcon =
    '<svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>'
  sleepTimer?.onTick(remainingMs => {
    if (!sleepEl) return
    if (remainingMs == null) {
      sleepEl.hidden = true
      sleepEl.innerHTML = ''
    } else {
      sleepEl.hidden = false
      sleepEl.innerHTML = `${sleepIcon}<span>${formatRemaining(remainingMs)}</span>`
    }
  })

  return {
    // Tells the mini player which album is currently loaded (and the opts
    // it was loaded with) for its thumbnail/title and for reopening the
    // right album, the right way, on click.
    setAlbum(album, opts = {}) {
      currentAlbum = album
      currentOpts = opts
      artEl.style.backgroundImage = album?.artUrl ? `url(${JSON.stringify(album.artUrl)})` : ''
      render()
    },
    hide() {
      modalOpen = true
      updateVisibility()
    },
    showIfActive() {
      modalOpen = false
      evaluatePlacement()
      updateVisibility()
    }
  }
}
