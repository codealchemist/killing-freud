export function cleanName(filename) {
  return filename.replace(/\.[^.]+$/, '').replace('-master', '')
}

export function formatSize(bytes) {
  return bytes ? `${(bytes / 1048576).toFixed(1)} MB` : ''
}

// Wires click-to-edit behavior for a text label backed by a hidden <input>,
// matching the inline album-name editor pattern used in demo mode.
export function initInlineEdit({ displayEl, inputEl, editBtn, onCommit, fallback = '' }) {
  const commit = () => {
    const value = inputEl.value.trim() || fallback || displayEl.textContent
    displayEl.textContent = value
    displayEl.hidden = false
    if (editBtn) editBtn.hidden = false
    inputEl.hidden = true
    onCommit(value)
  }

  const enterEdit = () => {
    inputEl.value = displayEl.textContent
    displayEl.hidden = true
    if (editBtn) editBtn.hidden = true
    inputEl.hidden = false
    inputEl.focus()
    inputEl.select()
  }

  displayEl.classList.add('is-editable')
  displayEl.setAttribute('role', 'button')
  displayEl.setAttribute('tabindex', '0')

  editBtn?.addEventListener('click', enterEdit)
  displayEl.addEventListener('click', enterEdit)
  displayEl.addEventListener('keydown', e => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      enterEdit()
    }
  })
  inputEl.addEventListener('blur', commit)
  inputEl.addEventListener('keydown', e => {
    if (e.key === 'Enter') {
      e.preventDefault()
      inputEl.blur()
    }
    if (e.key === 'Escape') {
      inputEl.value = displayEl.textContent
      inputEl.blur()
    }
  })
}
