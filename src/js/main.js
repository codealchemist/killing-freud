import { AudioPlayer } from './player.js'
import { initGallery } from './gallery.js'
import { initLyrics } from './lyrics.js'
import { initSharing } from './sharing.js'
import { version } from '../../package.json'
import * as DemoMode from './demo-mode.js'
import { initDropZone } from './drop-zone.js'
import { initShareButton, initIncomingSession } from './demo-share-ui.js'

// ─── Service Worker (PWA + offline) ───────────────────────
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(err => {
      console.warn('SW registration failed:', err)
    })
  })
}

// ─── Offline banner ────────────────────────────────────────
const offlineBanner = document.getElementById('offlineBanner')
function syncOnlineState() {
  if (offlineBanner) offlineBanner.hidden = navigator.onLine
}
window.addEventListener('online', syncOnlineState)
window.addEventListener('offline', syncOnlineState)
syncOnlineState()

// ─── Sticky nav shadow on scroll ──────────────────────────
const nav = document.getElementById('nav')
window.addEventListener(
  'scroll',
  () => {
    nav.style.boxShadow =
      window.scrollY > 10 ? '0 2px 24px rgba(0,0,0,0.5)' : ''
  },
  { passive: true }
)

// ─── Active nav section highlight ─────────────────────────
const sectionAnchors = Array.from(
  document.querySelectorAll('.nav__links a[href^="#"]')
)

function updateActiveSection() {
  const atBottom =
    window.scrollY + window.innerHeight >= document.documentElement.scrollHeight - 10
  const threshold = atBottom
    ? document.documentElement.scrollHeight
    : window.scrollY + window.innerHeight * 0.4

  let active = null
  for (const a of sectionAnchors) {
    const section = document.getElementById(a.getAttribute('href').slice(1))
    if (!section || section.hidden) continue
    if (section.offsetTop <= threshold) active = a
  }
  sectionAnchors.forEach(a => a.classList.toggle('is-active', a === active))
}

window.addEventListener('scroll', updateActiveSection, { passive: true })
updateActiveSection()

// ─── Mobile burger menu ────────────────────────────────────
const burger = document.getElementById('navBurger')
const navLinks = document.querySelector('.nav__links')
burger?.addEventListener('click', () => {
  navLinks.classList.toggle('is-open')
  document.body.classList.toggle('nav-open')
})
// Close menu on link click (delay closing slightly to avoid scroll-jump)
navLinks?.querySelectorAll('a').forEach(a => {
  a.addEventListener('click', () => {
    // allow browser to perform anchor scroll first, then close menu
    setTimeout(() => navLinks.classList.remove('is-open'), 160)
  })
})
// ensure body class removed when menu closes via links
navLinks?.addEventListener('transitionend', () => {
  if (!navLinks.classList.contains('is-open'))
    document.body.classList.remove('nav-open')
})
// ensure a force-open class when menu is opened to work around CSS clipping
burger?.addEventListener('click', () => {
  if (navLinks.classList.contains('is-open')) {
    navLinks.classList.add('force-open')
  } else {
    navLinks.classList.remove('force-open')
  }
})

// ─── Footer year ───────────────────────────────────────────
const yearEl = document.getElementById('footerYear')
if (yearEl) yearEl.textContent = new Date().getFullYear()

const versionEl = document.getElementById('footerVersion')
if (versionEl) versionEl.textContent = `v${version}`

// ─── Drop zone (always active) ────────────────────────────
initDropZone()

// ─── Demo mode banner ─────────────────────────────────────
const demoBanner = document.getElementById('demoBanner')
if (DemoMode.isActive() && demoBanner) {
  demoBanner.hidden = false
  document.body.classList.add('demo-mode')

  const hintEl      = document.getElementById('demoBannerHint')
  const musicTitleEl = document.getElementById('musicSectionTitle')
  const nameInputEl = document.getElementById('musicNameInput')
  const editBtnEl   = document.getElementById('musicEditNameBtn')
  const artAreaEl   = document.getElementById('musicArtArea')
  const artDropEl   = document.getElementById('musicArtDrop')
  const artInputEl  = document.getElementById('musicArtInput')
  const artImgEl    = document.getElementById('musicAlbumArt')
  const playerEl    = document.querySelector('.player')

  const applyArt = dataUrl => {
    DemoMode.setAlbumArt(dataUrl)
    artImgEl.src = dataUrl
    artImgEl.hidden = false
    if (playerEl) {
      playerEl.style.setProperty('--player-art', `url("${dataUrl}")`)
      playerEl.classList.add('has-art')
    }
  }

  // ── Initialise from stored state ──────────────────────────
  const storedName = DemoMode.getAlbumName()
  if (musicTitleEl) musicTitleEl.textContent = storedName
  if (hintEl) hintEl.textContent = `Listening to ${storedName}`

  const storedArt = DemoMode.getAlbumArt()
  if (storedArt) applyArt(storedArt)

  // ── Art area (desktop only) ───────────────────────────────
  if (artAreaEl) artAreaEl.hidden = false

  if (!DemoMode.isReceived()) {
    const processAndApply = async file => {
      if (!file) return
      const ART_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp'])
      if (!ART_TYPES.has(file.type) || file.size > 2 * 1024 * 1024) return
      const img = new Image()
      const blobUrl = URL.createObjectURL(file)
      img.onload = () => {
        URL.revokeObjectURL(blobUrl)
        const MAX = 512, scale = Math.min(1, MAX / Math.max(img.width, img.height))
        const w = Math.round(img.width * scale), h = Math.round(img.height * scale)
        const canvas = document.createElement('canvas')
        canvas.width = w; canvas.height = h
        canvas.getContext('2d').drawImage(img, 0, 0, w, h)
        applyArt(canvas.toDataURL('image/jpeg', 0.82))
      }
      img.src = blobUrl
    }

    artInputEl?.addEventListener('change', e => processAndApply(e.target.files?.[0]))
    artDropEl?.addEventListener('click', () => artInputEl?.click())
    artDropEl?.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') artInputEl?.click() })
    artDropEl?.addEventListener('dragover', e => { e.preventDefault(); artDropEl.classList.add('is-dragging') })
    artDropEl?.addEventListener('dragleave', () => artDropEl.classList.remove('is-dragging'))
    artDropEl?.addEventListener('drop', e => {
      e.preventDefault()
      artDropEl.classList.remove('is-dragging')
      processAndApply(e.dataTransfer.files?.[0])
    })

    // ── Inline album name editing ─────────────────────────────
    if (editBtnEl) editBtnEl.hidden = false
    if (musicTitleEl) {
      musicTitleEl.classList.add('is-editable')
      musicTitleEl.setAttribute('role', 'button')
      musicTitleEl.setAttribute('tabindex', '0')
    }

    const commitName = () => {
      const newName = (nameInputEl.value.trim() || 'DEMO').toUpperCase()
      DemoMode.setAlbumName(newName)
      if (musicTitleEl) musicTitleEl.textContent = newName
      if (hintEl) hintEl.textContent = `Listening to ${newName}`
      musicTitleEl.hidden = false
      editBtnEl.hidden = false
      nameInputEl.hidden = true
    }

    const enterEditMode = () => {
      nameInputEl.value = musicTitleEl.textContent
      musicTitleEl.hidden = true
      editBtnEl.hidden = true
      nameInputEl.hidden = false
      nameInputEl.focus()
      nameInputEl.select()
    }

    editBtnEl?.addEventListener('click', enterEditMode)
    musicTitleEl?.addEventListener('click', enterEditMode)
    musicTitleEl?.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); enterEditMode() }
    })
    nameInputEl?.addEventListener('blur', commitName)
    nameInputEl?.addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); nameInputEl.blur() }
      if (e.key === 'Escape') {
        nameInputEl.value = musicTitleEl.textContent  // discard edit
        nameInputEl.blur()
      }
    })
  }

  document.getElementById('music')?.scrollTo(0, 0)
  document.getElementById('demoBannerExit')?.addEventListener('click', () => DemoMode.exit())
}

// ─── Incoming share session (detected on any page load) ───
const _qs = new URLSearchParams(location.search)
const shareParam = _qs.get('demo-share')
if (shareParam) {
  // Strip control characters and cap length; textContent handles the rest
  const rawAlbum = _qs.get('album') ?? ''
  const albumParam = rawAlbum.replace(/[\x00-\x1f\x7f]/g, '').trim().slice(0, 50)
  initIncomingSession(shareParam, albumParam || undefined)
}

// ─── Audio Player ──────────────────────────────────────────
const player = new AudioPlayer()
if (DemoMode.isActive()) {
  DemoMode.getTracks().then(tracks => {
    player.init(tracks)
    initShareButton(tracks)
  })
} else {
  player.init()
}

// ─── Gallery ───────────────────────────────────────────────
initGallery()
initLyrics()
initSharing()

// ─── Social links ──────────────────────────────────────────
fetch('/api/config')
  .then(r => r.json())
  .then(({ social }) => {
    // Backwards-compatible: support `site` metadata when provided
    // The config function may include `site: { title, description, url, ogImage, themeColor }`.
    return { social }
  })
  .then(async ({ social }) => {
    // try fetching extended config (site metadata) from the same endpoint
    let cfg = { social }
    try {
      const res = await fetch('/api/config')
      if (res.ok) cfg = await res.json()
    } catch (e) {
      /* ignore */
    }
    const { social: socialConf, site } = cfg
    const map = {
      instagram: document.querySelector('.social-link[aria-label="Instagram"]'),
      spotify: document.querySelector('.social-link[aria-label="Spotify"]'),
      youtube: document.querySelector('.social-link[aria-label="YouTube"]'),
      email: document.querySelector('.social-link[aria-label="Email"]')
    }
    if (socialConf?.instagram)
      map.instagram?.setAttribute('href', socialConf.instagram)
    if (socialConf?.spotify)
      map.spotify?.setAttribute('href', socialConf.spotify)
    if (socialConf?.youtube)
      map.youtube?.setAttribute('href', socialConf.youtube)
    if (socialConf?.email)
      map.email?.setAttribute('href', `mailto:${socialConf.email}`)

    // Update meta tags + title when `site` metadata is present
    if (site) {
      if (site.title) document.title = site.title
      const setMeta = (selector, attr, value) => {
        if (!value) return
        let el = document.querySelector(selector)
        if (!el) {
          el = document.createElement('meta')
          const parts = selector.match(/\[(.+?)=(?:"|')(.+?)(?:"|')\]/)
          if (parts) el.setAttribute(parts[1], parts[2])
          document.head.appendChild(el)
        }
        el.setAttribute(attr, value)
      }

      setMeta('meta[name="description"]', 'content', site.description)
      setMeta('meta[property="og:title"]', 'content', site.title)
      setMeta('meta[property="og:description"]', 'content', site.description)
      if (site.url) setMeta('meta[property="og:url"]', 'content', site.url)
      setMeta('meta[property="og:image"]', 'content', site.ogImage)
      setMeta('meta[name="twitter:title"]', 'content', site.title)
      setMeta('meta[name="twitter:description"]', 'content', site.description)
      setMeta('meta[name="twitter:image"]', 'content', site.ogImage)
      if (site.themeColor)
        setMeta('meta[name="theme-color"]', 'content', site.themeColor)

      // Update canonical link
      if (site.url) {
        let link = document.querySelector('link[rel="canonical"]')
        if (!link) {
          link = document.createElement('link')
          link.setAttribute('rel', 'canonical')
          document.head.appendChild(link)
        }
        link.setAttribute('href', site.url)
      }
    }

    // continue with social-disable logic below
    const finalSocial = socialConf || social
    // Gray out and disable links with no configured URL
    Object.entries(map).forEach(([key, el]) => {
      if (!el) return
      const hasUrl = Boolean(finalSocial[key])
      if (!hasUrl) {
        // Preserve existing mailto in markup — only disable placeholder/hash links
        el.classList.add('social-link--disabled')
        el.setAttribute('aria-disabled', 'true')
        el.setAttribute('tabindex', '-1')
        el.removeAttribute('href')
        el.addEventListener('click', e => e.preventDefault())
      }
    })
  })
  .catch(() => {}) // social links degrade gracefully

// Open non-hash links in a new window/tab for better UX
document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('a[href]').forEach(a => {
    const href = a.getAttribute('href')
    if (!href) return
    // skip internal hash anchors and mailto links
    if (href.startsWith('#') || href.startsWith('mailto:')) return
    // already intentionally left without href (disabled)
    if (!a.hasAttribute('href')) return
    a.setAttribute('target', '_blank')
    const existingRel = a.getAttribute('rel') || ''
    const relParts = new Set(existingRel.split(/\s+/).filter(Boolean))
    relParts.add('noopener')
    relParts.add('noreferrer')
    a.setAttribute('rel', Array.from(relParts).join(' '))
  })
})
