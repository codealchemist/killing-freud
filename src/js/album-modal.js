// Single reusable album modal shell — rebound to whichever album is open.
// Chrome (open/close/tabs/header) only; the Player/Lyrics/Sharing panels'
// actual content is rendered by whoever registers a loader via
// setPlayerLoader/setLyricsLoader/setSharingLoader (see main.js).
export function initAlbumModal({ onOpen, onClose } = {}) {
  const modal = document.getElementById('albumModal')
  if (!modal) return null

  const closeBtn = document.getElementById('albumModalClose')
  const titleEl = document.getElementById('albumModalTitle')
  const blurbEl = document.getElementById('albumModalBlurb')
  const artAreaEl = document.getElementById('musicArtArea')
  const artDropEl = document.getElementById('musicArtDrop')
  const artImgEl = document.getElementById('musicAlbumArt')
  const tabsEl = document.getElementById('albumModalTabs')
  const tabLyricsBtn = document.getElementById('albumTabLyrics')
  const tabSharingBtn = document.getElementById('albumTabSharing')
  const panels = {
    player: modal.querySelector('[data-panel="player"]'),
    lyrics: modal.querySelector('[data-panel="lyrics"]'),
    sharing: modal.querySelector('[data-panel="sharing"]')
  }

  const loaders = { player: null, lyrics: null, sharing: null }
  let currentAlbum = null
  let currentOpts = {}

  function setTab(name) {
    tabsEl?.querySelectorAll('.album-modal__tab').forEach(btn => {
      btn.classList.toggle('is-active', btn.dataset.tab === name)
    })
    Object.entries(panels).forEach(([key, el]) => {
      if (el) el.hidden = key !== name
    })
    if (currentAlbum) loaders[name]?.(currentAlbum, currentOpts)
  }

  tabsEl?.addEventListener('click', e => {
    const btn = e.target.closest('.album-modal__tab')
    if (!btn || btn.hidden) return
    setTab(btn.dataset.tab)
  })

  function open(album, opts = {}) {
    currentAlbum = album
    currentOpts = opts

    titleEl.textContent = album.title
    if (blurbEl) {
      blurbEl.textContent = album.subtitle || ''
      blurbEl.hidden = !album.subtitle
    }

    const hasArt = Boolean(album.artUrl)
    if (artImgEl) {
      if (hasArt) {
        artImgEl.src = album.artUrl
        artImgEl.hidden = false
      } else {
        artImgEl.hidden = true
        artImgEl.removeAttribute('src')
      }
    }
    if (artAreaEl) artAreaEl.hidden = !(hasArt || opts.editable)
    if (artDropEl) {
      artDropEl.classList.toggle('is-readonly', !opts.editable)
      artDropEl.setAttribute('tabindex', opts.editable ? '0' : '-1')
      artDropEl.setAttribute('aria-hidden', opts.editable ? 'false' : 'true')
    }

    if (tabLyricsBtn) tabLyricsBtn.hidden = !album.hasLyrics
    if (tabSharingBtn) tabSharingBtn.hidden = !album.hasSharing

    document.body.style.overflow = 'hidden'
    modal.hidden = false

    const requestedTab = opts.tab
    const tabBtn = requestedTab && tabsEl?.querySelector(`[data-tab="${requestedTab}"]`)
    setTab(tabBtn && !tabBtn.hidden ? requestedTab : 'player')

    onOpen?.(album)
  }

  function close() {
    document.body.style.overflow = ''
    modal.hidden = true
    onClose?.()
  }

  closeBtn?.addEventListener('click', close)
  modal.addEventListener('click', e => {
    if (e.target === modal) close()
  })
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && !modal.hidden) close()
  })

  return {
    open,
    close,
    isOpen: () => !modal.hidden,
    getCurrentAlbum: () => currentAlbum,
    setPlayerLoader: fn => { loaders.player = fn },
    setLyricsLoader: fn => { loaders.lyrics = fn },
    setSharingLoader: fn => { loaders.sharing = fn }
  }
}
