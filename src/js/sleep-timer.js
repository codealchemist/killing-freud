// Standalone countdown engine — deliberately audio-agnostic (only emits
// `onTick`/`onExpire`) so it stays reusable and testable independent of
// AudioPlayer. Tracks a wall-clock end timestamp rather than an
// accumulating counter, so a throttled background tab can't drift the
// countdown — whenever a delayed timeout finally fires (or the tab regains
// visibility), it re-derives the remaining time from `Date.now()`.
export function createSleepTimer() {
  let endAt = null
  let timeoutId = null
  const tickListeners = []
  const expireListeners = []

  function clearPending() {
    if (timeoutId) clearTimeout(timeoutId)
    timeoutId = null
  }

  function notifyTick(remaining) {
    tickListeners.forEach(cb => cb(remaining))
  }

  function tick() {
    if (endAt == null) return
    const remaining = endAt - Date.now()
    if (remaining <= 0) {
      endAt = null
      clearPending()
      notifyTick(null)
      expireListeners.forEach(cb => cb())
      return
    }
    notifyTick(remaining)
    // Re-check at least once a second while visible; a background tab may
    // delay this well past 1s, but the wall-clock check above still fires
    // expiry at the right time (bounded by the browser's own throttling).
    timeoutId = setTimeout(tick, Math.min(remaining, 1000))
  }

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && endAt != null) {
      clearPending()
      tick()
    }
  })

  return {
    start(ms) {
      clearPending()
      endAt = Date.now() + ms
      tick()
    },
    // Explicit cancel only — nothing about normal playback (pause, skip,
    // volume changes) touches the timer.
    cancel() {
      if (endAt == null) return
      clearPending()
      endAt = null
      notifyTick(null)
    },
    isActive: () => endAt != null,
    remainingMs: () => (endAt == null ? null : Math.max(0, endAt - Date.now())),
    // `remainingMs` (or null when off) on every tick and on cancel.
    onTick(cb) { tickListeners.push(cb) },
    // Fires once when the countdown reaches zero on its own (not on cancel).
    onExpire(cb) { expireListeners.push(cb) }
  }
}
