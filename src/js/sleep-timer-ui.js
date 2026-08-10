export function formatRemaining(ms) {
  const totalSec = Math.max(0, Math.round(ms / 1000))
  const m = Math.floor(totalSec / 60)
  const s = totalSec % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

// Wires the player panel's sleep-timer button + preset menu to a
// `sleepTimer` (see sleep-timer.js). Chrome only — starting/cancelling the
// countdown and reacting to expiry live in main.js/player.js.
export function initSleepTimerUI({ sleepTimer, player }) {
  const btn = document.getElementById('btnSleepTimer')
  const remainingEl = document.getElementById('sleepTimerRemaining')
  const menu = document.getElementById('sleepTimerMenu')
  const offBtn = document.getElementById('sleepTimerOff')
  if (!btn || !menu) return

  const closeMenu = () => {
    menu.hidden = true
    btn.setAttribute('aria-expanded', 'false')
  }
  const openMenu = () => {
    menu.hidden = false
    btn.setAttribute('aria-expanded', 'true')
  }

  btn.addEventListener('click', e => {
    e.stopPropagation()
    if (menu.hidden) openMenu()
    else closeMenu()
  })
  document.addEventListener('click', e => {
    if (!menu.hidden && !e.target.closest('.player__sleep')) closeMenu()
  })
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && !menu.hidden) closeMenu()
  })

  menu.querySelectorAll('.player__sleep-option[data-minutes]').forEach(opt => {
    opt.addEventListener('click', () => {
      sleepTimer.start(parseInt(opt.dataset.minutes, 10) * 60_000)
      closeMenu()
    })
  })

  offBtn?.addEventListener('click', () => {
    sleepTimer.cancel()
    closeMenu()
  })

  sleepTimer.onTick(remainingMs => {
    const active = remainingMs != null
    btn.classList.toggle('is-active', active)
    if (offBtn) offBtn.hidden = !active
    if (active) {
      remainingEl.hidden = false
      remainingEl.textContent = formatRemaining(remainingMs)
      btn.setAttribute('aria-label', `Sleep timer: ${formatRemaining(remainingMs)} remaining`)
    } else {
      remainingEl.hidden = true
      remainingEl.textContent = ''
      btn.setAttribute('aria-label', 'Sleep timer')
    }
  })

  sleepTimer.onExpire(() => player.fadeOutAndPause())
}
