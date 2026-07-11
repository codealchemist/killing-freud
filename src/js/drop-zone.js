import { enter } from './demo-mode.js'

function initSectionDropZone({ container, overlay, overlayText, message, onDrop }) {
  if (!container || !overlay) return
  let dragDepth = 0

  const showOverlay = () => {
    const rect = container.getBoundingClientRect()
    overlay.style.top = `${rect.top}px`
    overlay.style.left = `${rect.left}px`
    overlay.style.width = `${rect.width}px`
    overlay.style.height = `${rect.height}px`
    if (overlayText) overlayText.textContent = message
    overlay.hidden = false
  }

  const hideOverlay = () => {
    overlay.hidden = true
  }

  container.addEventListener('dragenter', e => {
    e.preventDefault()
    dragDepth++
    if (dragDepth === 1) showOverlay()
  })

  container.addEventListener('dragleave', () => {
    dragDepth--
    if (dragDepth <= 0) {
      dragDepth = 0
      hideOverlay()
    }
  })

  container.addEventListener('dragover', e => {
    e.preventDefault()
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'
  })

  container.addEventListener('drop', async e => {
    e.preventDefault()
    dragDepth = 0
    hideOverlay()

    const files = Array.from(e.dataTransfer?.files ?? []).filter(f =>
      f.type.startsWith('audio/')
    )
    if (!files.length) return

    await onDrop(files)
  })
}

export function initDropZone({ onMultitrackDrop } = {}) {
  const overlay = document.getElementById('dropOverlay')
  const overlayText = overlay?.querySelector('p')

  // Safety net: outside the hero/multitrack zones below, still swallow the
  // event so the browser doesn't navigate away to display the dropped file.
  document.addEventListener('dragover', e => e.preventDefault())
  document.addEventListener('drop', e => e.preventDefault())

  // Hero section: dropping files here always starts demo mode, regardless
  // of whether a multitrack session happens to be open elsewhere on the page.
  initSectionDropZone({
    container: document.getElementById('hero'),
    overlay,
    overlayText,
    message: 'Drop audio files to listen',
    onDrop: files => enter(files)
  })

  // Multitrack modal: only receives drag events while open (it's `hidden`
  // otherwise), so this only ever fires with a session in view. Dropping
  // here always feeds the multitrack editor, never demo mode.
  initSectionDropZone({
    container: document.getElementById('multitrack'),
    overlay,
    overlayText,
    message: 'Drop audio files to add tracks',
    onDrop: files => onMultitrackDrop?.(files)
  })
}
