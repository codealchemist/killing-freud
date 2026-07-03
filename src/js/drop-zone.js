import { enter } from './demo-mode.js'

export function initDropZone() {
  const overlay = document.getElementById('dropOverlay')
  let dragDepth = 0

  document.addEventListener('dragenter', e => {
    e.preventDefault()
    dragDepth++
    if (overlay && dragDepth === 1) overlay.hidden = false
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

    await enter(files)
  })
}
