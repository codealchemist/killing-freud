import { enter } from './demo-mode.js'

export function initDropZone({ onMultitrackDrop } = {}) {
  const overlay = document.getElementById('dropOverlay')
  const overlayText = overlay?.querySelector('p')
  let dragDepth = 0

  document.addEventListener('dragenter', e => {
    e.preventDefault()
    dragDepth++
    if (overlay && dragDepth === 1) {
      const isMultitrack = document.body.classList.contains('multitrack-mode')
      if (overlayText)
        overlayText.textContent = isMultitrack
          ? 'Drop audio files to add tracks'
          : 'Drop audio files to listen'
      // In demo mode the album art drop target sits above the player, in the
      // music header — keep it clear of the scrim so it stays usable.
      const player = document.body.classList.contains('demo-mode')
        ? document.querySelector('.player')
        : null
      overlay.style.top = player ? `${player.getBoundingClientRect().top}px` : ''
      overlay.hidden = false
    }
  })

  document.addEventListener('dragleave', () => {
    dragDepth--
    if (overlay && dragDepth === 0) overlay.hidden = true
  })

  document.addEventListener('dragover', e => {
    e.preventDefault()
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'
  })

  document.addEventListener('drop', async e => {
    e.preventDefault()
    dragDepth = 0
    if (overlay) overlay.hidden = true

    const files = Array.from(e.dataTransfer?.files ?? []).filter(f =>
      f.type.startsWith('audio/')
    )
    if (!files.length) return

    if (document.body.classList.contains('multitrack-mode') && onMultitrackDrop) {
      await onMultitrackDrop(files)
      return
    }

    await enter(files)
  })
}
