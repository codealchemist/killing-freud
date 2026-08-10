import { cleanName, formatSize } from './utils.js'
import {
  downloadTrack,
  getTrackBlob,
  getCachedMap,
  deleteTrack,
  clearAll,
  diffTracks
} from './download-manager.js'

const ICON = {
  download: `<svg viewBox="0 0 24 24" fill="currentColor" width="15" height="15"><path d="M13 5v8h3l-4 5-4-5h3V5h2zm-7 14h12v-2H6v2z"/></svg>`,
  trash: `<svg viewBox="0 0 24 24" fill="currentColor" width="15" height="15"><path d="M9 3v1H4v2h1v13a2 2 0 002 2h10a2 2 0 002-2V6h1V4h-5V3H9zm0 5h2v9H9V8zm4 0h2v9h-2V8z"/></svg>`,
  refresh: `<svg viewBox="0 0 24 24" fill="currentColor" width="15" height="15"><path d="M17.65 6.35A8 8 0 1 0 19.7 14H17.7A6 6 0 1 1 12 6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z"/></svg>`,
  spinner: `<svg class="spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="15" height="15"><circle cx="12" cy="12" r="9" stroke-dasharray="30 56" stroke-linecap="round"/></svg>`
}

function offlineBtnAttrs(state) {
  switch (state) {
    case 'cached':
      return { icon: ICON.trash, label: 'Remove offline copy' }
    case 'update':
      return { icon: ICON.refresh, label: 'Update available' }
    case 'downloading':
      return { icon: ICON.spinner, label: 'Downloading…' }
    case 'offline-only':
      return { icon: ICON.trash, label: 'Remove from device' }
    default:
      return { icon: ICON.download, label: 'Download for offline' }
  }
}

export class AudioPlayer {
  constructor() {
    this.audio = document.getElementById('audioEl')
    this.tracks = []
    this.currentIndex = -1
    this._currentObjectURL = null
    this._cachedMap = new Map()
    this._downloading = new Set()
    this._isDemo = false
    // Fetched track lists keyed by album slug, so reopening an already-open
    // album's Player tab doesn't re-hit Cloudinary or reset playback.
    this._trackCache = new Map()
    this._currentSlug = null
    this._playing = false
    this._progressPct = 0
    this._fadeRafId = null
    // Subscribers (mini-player.js) notified on every playback/track change.
    this._changeListeners = []
    // Track durations, probed lazily and cached by track id — shared
    // between the tracklist's "time" column and the album summary text,
    // so each track is only probed once regardless of how many times the
    // tracklist re-renders or the meta column toggle is flipped.
    this._durations = new Map()
    this._metaMode = 'time' // 'time' | 'size' — which the tracklist shows
    this._tracklistHeaderEl = null

    this.btnPlay = document.getElementById('btnPlay')
    this.btnPrev = document.getElementById('btnPrev')
    this.btnNext = document.getElementById('btnNext')
    this.volumeSlider = document.getElementById('volumeSlider')
    this.progressBar = document.getElementById('progressBar')
    this.progressFill = document.getElementById('progressFill')
    this.currentTimeEl = document.getElementById('currentTime')
    this.totalTimeEl = document.getElementById('totalTime')
    this.trackNameEl = document.getElementById('playerTrackName')
    this.trackIndexEl = document.getElementById('playerTrackIndex')
    this.tracklistEl = document.getElementById('tracklist')
    this.tracklistEmptyEl = document.getElementById('tracklistEmpty')
    this.loadingEl = document.getElementById('playerLoading')
    this.errorEl = document.getElementById('playerError')
    this.artworkInner = document.querySelector('.player__artwork-inner')
    this.offlineControlsEl = document.getElementById('offlineControls')

    this.audio.volume = parseFloat(this.volumeSlider.value)
    this._bindEvents()

    // Single delegated listener, bound once — survives every tracklist
    // re-render across album switches.
    this.tracklistEl.addEventListener('click', e => {
      const btn = e.target.closest('.tracklist__offline-btn')
      if (!btn) return
      e.stopPropagation()
      this._handleOfflineAction(parseInt(btn.dataset.index, 10))
    })
  }

  // Loads `album` into the shared player DOM. `opts.tracks` (demo mode)
  // supplies tracks directly, skipping the network fetch entirely.
  //
  // Reopening the same non-demo album (same slug) is a no-op: it neither
  // refetches Cloudinary nor resets playback, so audio kept playing behind
  // a closed modal is undisturbed. Only switching to a *different* album
  // does a hard reset (pause, revoke object URL, clear selection).
  async loadAlbum(album, opts = {}) {
    const slug = album.slug
    const isDemo = Boolean(opts.tracks)

    if (!isDemo && slug === this._currentSlug) return

    this.audio.pause()
    if (this._currentObjectURL) {
      URL.revokeObjectURL(this._currentObjectURL)
      this._currentObjectURL = null
    }
    this.currentIndex = -1
    this.trackNameEl.textContent = 'Select a track'
    this.trackIndexEl.textContent = '—'
    this._setPlayingState(false)

    this._isDemo = isDemo
    this._currentSlug = slug
    this._showLoading(true)
    this._showError(false)

    if (isDemo) {
      this.tracks = opts.tracks
      this._renderTracklist()
      this._renderAlbumMeta()
      if (this.offlineControlsEl) this.offlineControlsEl.hidden = true
      this._showLoading(false)
      return
    }

    if (this._trackCache.has(slug)) {
      this.tracks = this._trackCache.get(slug)
    } else {
      try {
        const res = await fetch(`/api/tracks?album=${encodeURIComponent(slug)}`)
        const data = await res.json()
        if (!res.ok)
          throw new Error(data.details || data.error || `HTTP ${res.status}`)
        // A different album may have been opened while this fetch was in
        // flight — bail out so its stale response doesn't clobber the DOM.
        if (this._currentSlug !== slug) return
        this.tracks = data
        this._trackCache.set(slug, data)
      } catch (err) {
        if (this._currentSlug !== slug) return
        console.error('Failed to load tracks:', err)
        // Offline fallback: show whatever is already in IndexedDB. Cached
        // tracks aren't tagged by album (Cloudinary public_ids are unique
        // account-wide), so this shows everything downloaded so far rather
        // than just this album's tracks.
        try {
          const map = await getCachedMap()
          if (map.size > 0) {
            this.tracks = [...map.values()].map(c => ({
              id: c.id,
              name: c.name,
              size: c.size,
              url: null,
              offlineState: 'offline-only',
              _cacheKey: c.id
            }))
          } else {
            this._showError(true, err.message)
            this._showLoading(false)
            return
          }
        } catch {
          this._showError(true, err.message)
          this._showLoading(false)
          return
        }
      }
    }

    if (this._currentSlug !== slug) return

    try {
      this._cachedMap = await getCachedMap()
      this._mergeOfflineState()
    } catch (e) {
      console.warn('Offline storage unavailable:', e)
    }

    this._renderTracklist()
    this._renderAlbumMeta()
    this._renderOfflineControls()
    this._showLoading(false)
  }

  // ─── Offline state ────────────────────────────────────────

  _mergeOfflineState() {
    const { cached, updates, offlineOnly } = diffTracks(
      this.tracks,
      this._cachedMap
    )
    const cachedIds = new Set(cached.map(t => t.id))
    const updateMap = new Map(updates.map(u => [u.server.id, u.cachedId]))

    this.tracks = this.tracks.map(t => {
      if (cachedIds.has(t.id))
        return { ...t, offlineState: 'cached', _cacheKey: t.id }
      if (updateMap.has(t.id))
        return { ...t, offlineState: 'update', _cacheKey: updateMap.get(t.id) }
      return { ...t, offlineState: 'idle', _cacheKey: null }
    })

    // Append tracks that exist only in cache (removed/renamed on server)
    offlineOnly.forEach(c =>
      this.tracks.push({
        id: c.id,
        name: c.name,
        size: c.size,
        url: null,
        offlineState: 'offline-only',
        _cacheKey: c.id
      })
    )
  }

  async _handleOfflineAction(index) {
    const track = this.tracks[index]
    if (!track || this._downloading.has(track.id)) return
    if (track.offlineState === 'idle') await this._downloadTrack(index)
    else if (track.offlineState === 'update') await this._updateTrack(index)
    else await this._deleteTrack(index)
  }

  async _downloadTrack(index) {
    const track = this.tracks[index]
    this._downloading.add(track.id)
    this._setItemState(index, 'downloading')
    try {
      await downloadTrack(track)
      this.tracks[index] = {
        ...track,
        offlineState: 'cached',
        _cacheKey: track.id
      }
      this._cachedMap.set(track.id, {
        id: track.id,
        name: track.name,
        size: track.size
      })
      this._setItemState(index, 'cached')
      this._renderOfflineControls()
    } catch (err) {
      console.error('Download failed:', err)
      this._setItemState(index, track.offlineState)
    } finally {
      this._downloading.delete(track.id)
    }
  }

  async _deleteTrack(index) {
    const track = this.tracks[index]
    const key = track._cacheKey || track.id
    try {
      await deleteTrack(key)
      this._cachedMap.delete(key)
      if (track.offlineState === 'offline-only') {
        if (index <= this.currentIndex) this.currentIndex--
        this.tracks.splice(index, 1)
        this._renderTracklist()
      } else {
        this.tracks[index] = { ...track, offlineState: 'idle', _cacheKey: null }
        this._setItemState(index, 'idle')
      }
      this._renderOfflineControls()
    } catch (err) {
      console.error('Delete failed:', err)
    }
  }

  async _updateTrack(index) {
    const track = this.tracks[index]
    const oldKey = track._cacheKey
    this._downloading.add(track.id)
    this._setItemState(index, 'downloading')
    try {
      await downloadTrack(track)
      if (oldKey && oldKey !== track.id) {
        await deleteTrack(oldKey)
        this._cachedMap.delete(oldKey)
      }
      this.tracks[index] = {
        ...track,
        offlineState: 'cached',
        _cacheKey: track.id
      }
      this._cachedMap.set(track.id, {
        id: track.id,
        name: track.name,
        size: track.size
      })
      this._setItemState(index, 'cached')
      this._renderOfflineControls()
    } catch (err) {
      console.error('Update failed:', err)
      this._setItemState(index, 'update')
    } finally {
      this._downloading.delete(track.id)
    }
  }

  async _downloadAll() {
    const pending = this.tracks
      .map((t, i) => ({ t, i }))
      .filter(
        ({ t }) => t.offlineState === 'idle' || t.offlineState === 'update'
      )
    if (!pending.length) return

    const fillEl = document.getElementById('offlineProgressFill')
    const labelEl = document.getElementById('offlineProgressLabel')
    const wrapEl = document.getElementById('offlineProgressWrap')
    const btn = document.getElementById('btnDownloadAll')
    if (btn) btn.disabled = true
    if (wrapEl) wrapEl.hidden = false

    for (let n = 0; n < pending.length; n++) {
      const { t, i } = pending[n]
      if (labelEl) labelEl.textContent = `${n + 1} / ${pending.length}`
      if (fillEl) fillEl.style.width = `${(n / pending.length) * 100}%`
      try {
        if (t.offlineState === 'update') await this._updateTrack(i)
        else await this._downloadTrack(i)
      } catch {
        /* continue with next track */
      }
    }

    if (fillEl) fillEl.style.width = '100%'
    if (labelEl) labelEl.textContent = `${pending.length} / ${pending.length}`
    setTimeout(() => {
      if (wrapEl) wrapEl.hidden = true
      if (btn) btn.disabled = false
      this._renderOfflineControls()
    }, 800)
  }

  async _clearAllOffline() {
    if (!confirm('Remove all downloaded tracks from this device?')) return
    try {
      await clearAll()
      this._cachedMap.clear()
      this.tracks = this.tracks
        .filter(t => t.offlineState !== 'offline-only')
        .map(t => ({ ...t, offlineState: 'idle', _cacheKey: null }))
      this._renderTracklist()
      this._renderOfflineControls()
    } catch (err) {
      console.error('Clear failed:', err)
    }
  }

  // ─── Playback ─────────────────────────────────────────────

  async playTrack(index) {
    if (index < 0 || index >= this.tracks.length) return
    const track = this.tracks[index]
    this.currentIndex = index
    this._updateActiveTrack()
    this._updateInfo(track.name, index)
    this._cancelFade()
    this.audio.pause()

    if (this._currentObjectURL) {
      URL.revokeObjectURL(this._currentObjectURL)
      this._currentObjectURL = null
    }

    const blob = track.blob ?? (track._cacheKey ? await getTrackBlob(track._cacheKey) : null)
    if (blob) {
      this._currentObjectURL = URL.createObjectURL(blob)
      this.audio.src = this._currentObjectURL
    } else if (track.url) {
      this.audio.src = track.url
    } else {
      console.warn('No audio source for:', track.name)
      return
    }

    try {
      await this.audio.play()
      this._setPlayingState(true)
    } catch (err) {
      console.error('Play failed:', err)
    }
  }

  // ─── Render ───────────────────────────────────────────────

  _renderTracklist() {
    if (this.tracks.length === 0) {
      this._tracklistHeaderEl?.remove()
      if (!this.tracklistEmptyEl.parentNode)
        this.tracklistEl.appendChild(this.tracklistEmptyEl)
      this.tracklistEmptyEl.textContent = 'No tracks found.'
      return
    }
    if (this.tracklistEmptyEl.parentNode) this.tracklistEmptyEl.remove()
    this.tracklistEl
      .querySelectorAll('.tracklist__item')
      .forEach(el => el.remove())
    this._ensureTracklistHeader()

    this.tracks.forEach((track, i) => {
      const { icon, label } = offlineBtnAttrs(track.offlineState)
      const item = document.createElement('div')
      item.className = 'tracklist__item'
      if (this._isDemo) item.classList.add('is-demo')
      if (track.offlineState === 'offline-only')
        item.classList.add('is-offline-only')
      item.dataset.index = i
      const offlineBtn = this._isDemo
        ? ''
        : `<button class="tracklist__offline-btn" data-index="${i}" data-state="${track.offlineState}" aria-label="${label}" title="${label}">${icon}</button>`
      item.innerHTML = `
        <span class="tracklist__num">${i + 1}</span>
        <span class="tracklist__name">${cleanName(track.name)}</span>
        <span class="tracklist__meta">${this._metaText(track)}</span>
        ${offlineBtn}
      `
      item.addEventListener('click', e => {
        if (e.target.closest('.tracklist__offline-btn')) return
        this.playTrack(i)
      })
      this.tracklistEl.appendChild(item)
    })

    this._refreshTrackDurations()
  }

  // ─── Track meta column (time / size toggle) ────────────────

  _metaText(track) {
    if (this._metaMode === 'size') return formatSize(track.size)
    const duration = this._durations.get(track.id)
    return duration != null ? this._formatTime(duration) : '—'
  }

  _setItemMeta(index) {
    const el = this.tracklistEl.querySelector(
      `.tracklist__item[data-index="${index}"] .tracklist__meta`
    )
    if (el) el.textContent = this._metaText(this.tracks[index])
  }

  _setMetaMode(mode) {
    if (this._metaMode === mode) return
    this._metaMode = mode
    this._updateMetaToggleUI()
    this.tracks.forEach((_, i) => this._setItemMeta(i))
  }

  _ensureTracklistHeader() {
    if (!this._tracklistHeaderEl) {
      const header = document.createElement('div')
      header.className = 'tracklist__header'
      header.innerHTML = `
        <span></span>
        <span></span>
        <div class="tracklist__meta-toggle" role="group" aria-label="Track info display">
          <button type="button" class="tracklist__meta-toggle-btn" data-mode="time" title="Track length">s</button>
          <button type="button" class="tracklist__meta-toggle-btn" data-mode="size" title="File size">MB</button>
        </div>
      `
      header.querySelectorAll('.tracklist__meta-toggle-btn').forEach(btn => {
        btn.addEventListener('click', () => this._setMetaMode(btn.dataset.mode))
      })
      this._tracklistHeaderEl = header
      this._updateMetaToggleUI()
    }
    this.tracklistEl.insertBefore(this._tracklistHeaderEl, this.tracklistEl.firstChild)
  }

  _updateMetaToggleUI() {
    const buttons = this._tracklistHeaderEl?.querySelectorAll('.tracklist__meta-toggle-btn')
    buttons?.forEach(btn => {
      const active = btn.dataset.mode === this._metaMode
      btn.classList.toggle('is-active', active)
      btn.setAttribute('aria-pressed', String(active))
    })
  }

  // Probes (and caches) the duration of every track not already known, so
  // the "time" column fills in progressively without re-fetching metadata
  // already learned from an earlier render or album visit.
  _refreshTrackDurations() {
    const tracksSnapshot = this.tracks
    tracksSnapshot.forEach((track, i) => {
      this._getDuration(track).then(() => {
        // A different album may have loaded while this was in flight.
        if (this.tracks !== tracksSnapshot) return
        if (this._metaMode === 'time') this._setItemMeta(i)
      })
    })
  }

  _getDuration(track) {
    if (this._durations.has(track.id)) return Promise.resolve(this._durations.get(track.id))
    return this._probeDuration(track).then(d => {
      this._durations.set(track.id, d)
      return d
    })
  }

  _setItemState(index, state) {
    const btn = this.tracklistEl.querySelector(
      `.tracklist__offline-btn[data-index="${index}"]`
    )
    if (!btn) return
    const { icon, label } = offlineBtnAttrs(state)
    btn.dataset.state = state
    btn.setAttribute('aria-label', label)
    btn.setAttribute('title', label)
    btn.innerHTML = icon
  }

  _renderOfflineControls() {
    const el = this.offlineControlsEl
    if (!el) return

    const idle = this.tracks.filter(t => t.offlineState === 'idle').length
    const updates = this.tracks.filter(t => t.offlineState === 'update').length
    const stored = this.tracks.filter(
      t => t.offlineState === 'cached' || t.offlineState === 'offline-only'
    )
    const bytes = stored.reduce((s, t) => s + (t.size || 0), 0)
    const pending = idle + updates

    if (pending === 0 && stored.length === 0) {
      el.hidden = true
      return
    }
    el.hidden = false

    const btnLabel =
      updates > 0 && idle === 0
        ? `Update ${updates} track${updates !== 1 ? 's' : ''}`
        : `Download ${pending} track${pending !== 1 ? 's' : ''}`
    const storageStr =
      bytes > 0 ? `${(bytes / 1048576).toFixed(1)} MB offline` : ''

    el.innerHTML = `
      <div class="offline-controls__row">
        ${pending > 0 ? `<button class="offline-controls__btn" id="btnDownloadAll">${btnLabel}</button>` : ''}
        ${storageStr ? `<span class="offline-controls__storage">${storageStr}</span>` : ''}
        ${stored.length ? `<button class="offline-controls__clear" id="btnClearOffline">Clear all</button>` : ''}
      </div>
      <div class="offline-controls__progress" id="offlineProgressWrap" hidden>
        <div class="offline-controls__bar">
          <div class="offline-controls__fill" id="offlineProgressFill"></div>
        </div>
        <span class="offline-controls__count" id="offlineProgressLabel"></span>
      </div>
    `
    document
      .getElementById('btnDownloadAll')
      ?.addEventListener('click', () => this._downloadAll())
    document
      .getElementById('btnClearOffline')
      ?.addEventListener('click', () => this._clearAllOffline())
  }

  // ─── Helpers ──────────────────────────────────────────────

  _bindEvents() {
    this.btnPlay.addEventListener('click', () => this._togglePlay())
    this.btnPrev.addEventListener('click', () => this._prevTrack())
    this.btnNext.addEventListener('click', () => this._nextTrack())
    this.volumeSlider.addEventListener('input', () => {
      // A manual volume change mid-fade means the user is taking explicit
      // control right now — stop overriding it and just apply their value.
      this._cancelFade()
      this.audio.volume = parseFloat(this.volumeSlider.value)
    })
    this.progressBar.addEventListener('click', e => {
      if (!this.audio.duration) return
      const rect = this.progressBar.getBoundingClientRect()
      this.audio.currentTime =
        ((e.clientX - rect.left) / rect.width) * this.audio.duration
    })
    this.audio.addEventListener('timeupdate', () => this._onTimeUpdate())
    this.audio.addEventListener('ended', () => this._nextTrack())
    this.audio.addEventListener('play', () => this._setPlayingState(true))
    this.audio.addEventListener('pause', () => this._setPlayingState(false))
    this.audio.addEventListener('durationchange', () => {
      this.totalTimeEl.textContent = this._formatTime(this.audio.duration)
    })
  }

  _togglePlay() {
    if (!this.audio.src) {
      if (this.tracks.length > 0) this.playTrack(0)
      return
    }
    if (this.audio.paused) this.audio.play()
    else this.audio.pause()
  }

  _prevTrack() {
    this.playTrack(
      this.currentIndex > 0 ? this.currentIndex - 1 : this.tracks.length - 1
    )
  }
  _nextTrack() {
    this.playTrack((this.currentIndex + 1) % this.tracks.length)
  }

  // ─── Public API for external controllers (mini-player.js) ────
  togglePlay() { this._togglePlay() }
  next() { this._nextTrack() }
  prev() { this._prevTrack() }
  pause() { this.audio.pause() }

  // Ramps volume to 0 over `ms`, pauses, then restores the volume slider's
  // value — used by the sleep timer so playback doesn't end with an abrupt
  // cut. A no-op if nothing is playing.
  fadeOutAndPause(ms = 8000) {
    if (this.audio.paused) return
    this._cancelFade()
    const startVolume = this.audio.volume
    const startTime = performance.now()

    const step = now => {
      const t = Math.min(1, (now - startTime) / ms)
      this.audio.volume = startVolume * (1 - t)
      if (t < 1 && !this.audio.paused) {
        this._fadeRafId = requestAnimationFrame(step)
      } else {
        this._fadeRafId = null
        this.audio.pause()
        this.audio.volume = startVolume
      }
    }
    this._fadeRafId = requestAnimationFrame(step)
  }

  _cancelFade() {
    if (this._fadeRafId == null) return
    cancelAnimationFrame(this._fadeRafId)
    this._fadeRafId = null
    this.audio.volume = parseFloat(this.volumeSlider.value)
  }

  // Registers a listener notified with `{ trackName, index, total, playing,
  // progress }` on every playback/track-selection change.
  onChange(callback) {
    this._changeListeners.push(callback)
  }

  _notifyChange() {
    if (!this._changeListeners.length) return
    const track = this.currentIndex >= 0 ? this.tracks[this.currentIndex] : null
    const snapshot = {
      trackName: track ? cleanName(track.name) : null,
      index: this.currentIndex,
      total: this.tracks.length,
      playing: this._playing,
      progress: this._progressPct
    }
    this._changeListeners.forEach(cb => cb(snapshot))
  }

  _onTimeUpdate() {
    const { currentTime, duration } = this.audio
    this.currentTimeEl.textContent = this._formatTime(currentTime)
    if (duration) {
      this._progressPct = (currentTime / duration) * 100
      this.progressFill.style.width = `${this._progressPct}%`
    }
    this._notifyChange()
  }

  _updateActiveTrack() {
    this.tracklistEl.querySelectorAll('.tracklist__item').forEach((el, i) => {
      el.classList.toggle('is-active', i === this.currentIndex)
    })
  }

  _updateInfo(name, index) {
    this.trackNameEl.textContent = cleanName(name)
    this.trackIndexEl.textContent = `${index + 1} / ${this.tracks.length}`
    this._notifyChange()
  }

  _setPlayingState(playing) {
    this._playing = playing
    this.btnPlay.querySelector('.icon-play').style.display = playing
      ? 'none'
      : ''
    this.btnPlay.querySelector('.icon-pause').style.display = playing
      ? ''
      : 'none'
    this.artworkInner?.classList.toggle('is-playing', playing)
    this._notifyChange()
  }

  _showLoading(show) {
    this.loadingEl.hidden = !show
  }

  _showError(show, message) {
    this.errorEl.hidden = !show
    if (show && message)
      this.errorEl.querySelector('span').textContent = message
  }

  _formatTime(s) {
    if (!s || isNaN(s)) return '0:00'
    return `${Math.floor(s / 60)}:${Math.floor(s % 60)
      .toString()
      .padStart(2, '0')}`
  }

  // ─── Album meta (song count + total duration) ─────────────

  _renderAlbumMeta() {
    const el = document.getElementById('musicSectionSubtitle')
    if (!el) return
    const count = this.tracks.length
    if (count === 0) { el.hidden = true; return }

    const label = n => `${n} song${n !== 1 ? 's' : ''}`
    // Size is already known synchronously (unlike duration, which needs
    // probing), so it's part of the text from the very first render.
    const totalBytes = this.tracks.reduce((s, t) => s + (t.size || 0), 0)
    const sizeStr = totalBytes > 0 ? ` (${formatSize(totalBytes)})` : ''
    el.textContent = `${label(count)}${sizeStr}`
    el.hidden = false

    // Shares the same probe/cache as the tracklist's "time" column
    // (_getDuration), so a track is never fetched twice.
    const tracksSnapshot = this.tracks
    Promise.allSettled(tracksSnapshot.map(t => this._getDuration(t)))
      .then(results => {
        if (this.tracks !== tracksSnapshot) return
        const total = results.reduce(
          (s, r) => s + (r.status === 'fulfilled' ? (r.value || 0) : 0), 0
        )
        if (total > 0)
          el.textContent = `${label(count)}, ${this._formatAlbumDuration(total)}${sizeStr}`
      })
  }

  _probeDuration(track) {
    return new Promise(resolve => {
      const isBlob = !!track.blob
      const url = isBlob ? URL.createObjectURL(track.blob) : track.url
      if (!url) return resolve(0)
      const a = new Audio()
      a.preload = 'metadata'
      const finish = d => {
        if (isBlob) URL.revokeObjectURL(url)
        a.src = ''
        resolve(isFinite(d) && d > 0 ? d : 0)
      }
      a.addEventListener('loadedmetadata', () => finish(a.duration), { once: true })
      a.addEventListener('error', () => finish(0), { once: true })
      a.src = url
    })
  }

  _formatAlbumDuration(secs) {
    const s = Math.round(secs)
    if (s < 60) return `${s} sec`
    const m = Math.floor(s / 60)
    if (m < 60) return `${m} min`
    const h = Math.floor(m / 60)
    const rem = m % 60
    return rem > 0 ? `${h} hr ${rem} min` : `${h} hr`
  }

}
