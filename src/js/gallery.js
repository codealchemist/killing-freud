/**
 * Gallery with lightbox
 * Loads images from /api/gallery, falls back to HTML placeholders.
 */
export async function initGallery() {
  const grid = document.getElementById('gallery-grid')
  const lightbox = document.getElementById('lightbox')
  const lightboxContent = document.getElementById('lightboxContent')
  const closeBtn = document.getElementById('lightboxClose')
  const prevBtn = document.getElementById('lightboxPrev')
  const nextBtn = document.getElementById('lightboxNext')

  if (!grid || !lightbox) return

  // Try to load images from the gallery API
  try {
    const res = await fetch('/api/gallery')
    if (res.ok) {
      const images = await res.json()
      if (images.length > 0) {
        grid.innerHTML = ''
        images.forEach((img, i) => {
          const item = document.createElement('div')
          item.className = 'gallery__item'
          item.dataset.index = i
          const el = document.createElement('img')
          el.src = img.url
          el.alt = img.name.replace(/\.[^.]+$/, '')
          el.loading = 'lazy'
          item.appendChild(el)
          grid.appendChild(item)
        })
      }
    }
  } catch (err) {
    console.error('Failed to load gallery images:', err)
    // Fall through — use whatever is already in the HTML (placeholders)
  }

  // Build item list after potential DOM update
  const items = Array.from(grid.querySelectorAll('.gallery__item'))
  let currentIndex = 0

  function openLightbox(index) {
    const item = items[index]
    if (!item) return
    currentIndex = index

    lightboxContent.innerHTML = ''

    const img = item.querySelector('img')
    if (img) {
      const clone = document.createElement('img')
      clone.src = img.src
      clone.alt = img.alt || ''
      lightboxContent.appendChild(clone)
    } else {
      const placeholder = document.createElement('div')
      placeholder.style.cssText = `
        padding: 60px 80px;
        background: var(--surface);
        border-radius: 8px;
        font-family: var(--font-heading);
        font-size: 1.5rem;
        color: var(--text-muted);
        letter-spacing: 0.1em;
      `
      placeholder.textContent =
        item.querySelector('span')?.textContent || 'Photo'
      lightboxContent.appendChild(placeholder)
    }

    lightbox.hidden = false
    document.body.style.overflow = 'hidden'
  }

  function closeLightbox() {
    lightbox.hidden = true
    document.body.style.overflow = ''
  }

  function navigate(dir) {
    currentIndex = (currentIndex + dir + items.length) % items.length
    openLightbox(currentIndex)
  }

  items.forEach((item, i) => {
    item.addEventListener('click', () => openLightbox(i))
  })

  closeBtn.addEventListener('click', closeLightbox)
  prevBtn.addEventListener('click', () => navigate(-1))
  nextBtn.addEventListener('click', () => navigate(1))

  lightbox.addEventListener('click', e => {
    if (e.target === lightbox) closeLightbox()
  })

  document.addEventListener('keydown', e => {
    if (lightbox.hidden) return
    if (e.key === 'Escape') closeLightbox()
    if (e.key === 'ArrowLeft') navigate(-1)
    if (e.key === 'ArrowRight') navigate(1)
  })

  // Touch / swipe support for lightbox navigation
  let touchStartX = 0
  let touchStartY = 0
  let touchMoveX = 0
  let touchMoveY = 0
  let isTouching = false

  function onTouchStart(e) {
    const t = e.touches ? e.touches[0] : e
    touchStartX = t.clientX
    touchStartY = t.clientY
    touchMoveX = touchMoveY = 0
    isTouching = true
  }

  function onTouchMove(e) {
    if (!isTouching) return
    const t = e.touches ? e.touches[0] : e
    touchMoveX = t.clientX - touchStartX
    touchMoveY = t.clientY - touchStartY
    // If horizontal swipe is dominant, prevent vertical page scroll
    if (Math.abs(touchMoveX) > Math.abs(touchMoveY)) {
      e.preventDefault()
    }
  }

  function onTouchEnd() {
    if (!isTouching) return
    isTouching = false
    const dx = touchMoveX
    const dy = touchMoveY
    const absX = Math.abs(dx)
    const absY = Math.abs(dy)
    const SWIPE_MIN = 40 // px
    if (absX > SWIPE_MIN && absX > absY) {
      if (dx < 0) navigate(1)
      else navigate(-1)
    }
  }

  // Attach touch handlers to lightbox content when open, and to the image
  lightbox.addEventListener('touchstart', onTouchStart, { passive: false })
  lightbox.addEventListener('touchmove', onTouchMove, { passive: false })
  lightbox.addEventListener('touchend', onTouchEnd)
  // Pointer fallback for desktops with touch-capable pointers
  lightbox.addEventListener('pointerdown', e => {
    if (e.pointerType === 'touch') onTouchStart(e)
  })
  lightbox.addEventListener('pointermove', e => {
    if (e.pointerType === 'touch') onTouchMove(e)
  })
  lightbox.addEventListener('pointerup', e => {
    if (e.pointerType === 'touch') onTouchEnd(e)
  })
}
