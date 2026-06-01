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
  }

  async init() {
    this._showLoading(true)
    this._showError(false)

    try {
      const res = await fetch('/api/tracks')
      const data = await res.json()
      if (!res.ok)
        throw new Error(data.details || data.error || `HTTP ${res.status}`)
      this.tracks = data
    } catch (err) {
      console.error('Failed to load tracks:', err)
      // Offline fallback: show whatever is already in IndexedDB
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

    try {
      this._cachedMap = await getCachedMap()
      this._mergeOfflineState()
    } catch (e) {
      console.warn('Offline storage unavailable:', e)
    }

    this._renderTracklist()
    this._renderOfflineControls()
    this._showLoading(false)

    // Single delegated listener — survives tracklist re-renders
    this.tracklistEl.addEventListener('click', e => {
      const btn = e.target.closest('.tracklist__offline-btn')
      if (!btn) return
      e.stopPropagation()
      this._handleOfflineAction(parseInt(btn.dataset.index, 10))
    })
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
    this.audio.pause()

    if (this._currentObjectURL) {
      URL.revokeObjectURL(this._currentObjectURL)
      this._currentObjectURL = null
    }

    const blob = track._cacheKey ? await getTrackBlob(track._cacheKey) : null
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
      if (!this.tracklistEmptyEl.parentNode)
        this.tracklistEl.appendChild(this.tracklistEmptyEl)
      this.tracklistEmptyEl.textContent = 'No tracks found.'
      return
    }
    if (this.tracklistEmptyEl.parentNode) this.tracklistEmptyEl.remove()
    this.tracklistEl
      .querySelectorAll('.tracklist__item')
      .forEach(el => el.remove())

    this.tracks.forEach((track, i) => {
      const { icon, label } = offlineBtnAttrs(track.offlineState)
      const item = document.createElement('div')
      item.className = 'tracklist__item'
      if (track.offlineState === 'offline-only')
        item.classList.add('is-offline-only')
      item.dataset.index = i
      item.innerHTML = `
        <span class="tracklist__num">${i + 1}</span>
        <span class="tracklist__name">${cleanName(track.name)}</span>
        <span class="tracklist__size">${formatSize(track.size)}</span>
        <button class="tracklist__offline-btn" data-index="${i}" data-state="${track.offlineState}" aria-label="${label}" title="${label}">${icon}</button>
      `
      item.addEventListener('click', e => {
        if (e.target.closest('.tracklist__offline-btn')) return
        this.playTrack(i)
      })
      this.tracklistEl.appendChild(item)
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

  _onTimeUpdate() {
    const { currentTime, duration } = this.audio
    this.currentTimeEl.textContent = this._formatTime(currentTime)
    if (duration)
      this.progressFill.style.width = `${(currentTime / duration) * 100}%`
  }

  _updateActiveTrack() {
    this.tracklistEl.querySelectorAll('.tracklist__item').forEach((el, i) => {
      el.classList.toggle('is-active', i === this.currentIndex)
    })
  }

  _updateInfo(name, index) {
    this.trackNameEl.textContent = cleanName(name)
    this.trackIndexEl.textContent = `${index + 1} / ${this.tracks.length}`
  }

  _setPlayingState(playing) {
    this.btnPlay.querySelector('.icon-play').style.display = playing
      ? 'none'
      : ''
    this.btnPlay.querySelector('.icon-pause').style.display = playing
      ? ''
      : 'none'
    this.artworkInner?.classList.toggle('is-playing', playing)
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

}
