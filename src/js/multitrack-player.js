// trackswitch pulls in d3 + opensheetmusicdisplay + papaparse (~450 KB
// gzipped) for sheet-music/alignment features this app never uses — load it
// lazily so visitors who never open the multitrack editor don't pay for it.
let _createDefaultTrackSwitch = null
async function loadTrackswitch() {
  if (!_createDefaultTrackSwitch) {
    ;({ createDefaultTrackSwitch: _createDefaultTrackSwitch } =
      await import('trackswitch'))
  }
  return _createDefaultTrackSwitch
}

const FEATURES = {
  trackVolumeControls: true,
  trackPanControls: true,
  globalVolume: true,
  seekBar: true,
  looping: true,
  keyboard: true,
  iosAudioUnlock: true,
  repeat: true,
  timer: true,
  exclusiveSolo: false,
  presets: false,
  tabView: false,
  customizablePanelOrder: false
}

const EXT_MIME = {
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  ogg: 'audio/ogg',
  m4a: 'audio/mp4',
  flac: 'audio/flac',
  aac: 'audio/aac'
}

function mimeTypeFor(track) {
  if (track.blob?.type) return track.blob.type
  const ext = track.name.split('.').pop()?.toLowerCase()
  return EXT_MIME[ext] || 'audio/mpeg'
}

export class MultitrackPlayer {
  constructor(rootEl) {
    this._root = rootEl
    this._controller = null
    this._tracks = []
    this._blobUrls = new Map() // trackId -> objectURL
    this._onTrackStateChange = null
    this._onError = null
    this._onRemoveTrack = null
  }

  onTrackStateChange(cb) {
    this._onTrackStateChange = cb
    return this
  }

  onError(cb) {
    this._onError = cb
    return this
  }

  onRemoveTrack(cb) {
    this._onRemoveTrack = cb
    return this
  }

  // Called at the end of load(). Idempotent — skips rows that already have
  // a button — since load() can run repeatedly as tracks are added/removed.
  //
  // Rows carry `data-track-index` matching the trackGroup array order,
  // which is the same order as `this._tracks`.
  injectRemoveButtons() {
    if (!this._onRemoveTrack) return
    this._root.querySelectorAll('li.track[data-track-index]').forEach(row => {
      if (row.querySelector('.track-remove-control')) return
      const track = this._tracks[Number(row.dataset.trackIndex)]
      if (!track) return

      const btn = document.createElement('button')
      btn.type = 'button'
      btn.className = 'track-remove-control'
      btn.setAttribute('aria-label', `Remove ${track.name}`)
      btn.title = 'Remove track'
      btn.textContent = '✕'
      btn.addEventListener('click', e => {
        e.preventDefault()
        e.stopPropagation()
        this._onRemoveTrack(track.id)
      })

      const target = row.querySelector('.track-mix-controls') || row
      target.appendChild(btn)
    })
  }

  _buildInit(tracks) {
    const currentIds = new Set(tracks.map(t => t.id))
    for (const [id, url] of this._blobUrls) {
      if (!currentIds.has(id)) {
        URL.revokeObjectURL(url)
        this._blobUrls.delete(id)
      }
    }

    const trackGroup = tracks.map(t => {
      let url = this._blobUrls.get(t.id)
      if (!url) {
        url = URL.createObjectURL(t.blob)
        this._blobUrls.set(t.id, url)
      }
      return {
        title: t.name,
        volume: t.state?.volume ?? 1,
        pan: t.state?.pan ?? 0,
        solo: t.state?.solo ?? true,
        sources: [{ src: url, type: mimeTypeFor(t) }]
      }
    })

    return {
      features: FEATURES,
      ui: [
        { type: 'trackGroup', trackGroup },
        {
          type: 'waveform',
          height: 72,
          waveformSource: 'audible',
          playbackFollowMode: 'center'
        }
      ]
    }
  }

  async load(tracks) {
    this._tracks = tracks
    const init = this._buildInit(tracks)

    try {
      if (!this._controller) {
        const createDefaultTrackSwitch = await loadTrackswitch()
        this._controller = createDefaultTrackSwitch(this._root, init)
        this._controller.on('trackState', ({ index, state }) => {
          const track = this._tracks[index]
          if (track && this._onTrackStateChange)
            this._onTrackStateChange(track.id, state)
        })
        this._controller.on('error', ({ message }) => {
          if (this._onError) this._onError(new Error(message))
        })
        await this._controller.load()
      } else {
        await this._controller.updateConfig(init)
      }
    } catch (err) {
      if (this._onError) this._onError(err)
    }

    this.injectRemoveButtons()
  }

  destroy() {
    this._controller?.destroy()
    this._controller = null
    for (const url of this._blobUrls.values()) URL.revokeObjectURL(url)
    this._blobUrls.clear()
    this._tracks = []
  }
}
