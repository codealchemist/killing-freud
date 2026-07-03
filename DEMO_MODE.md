# DEMO Mode — Implementation Plan

## Overview

Users can drag and drop MP3 files onto the site to open the audio player in **DEMO mode**. All player features (offline playback, loop, prev/next) work with the dropped files. A banner with an X button lets users exit DEMO mode, which cleans up all dropped file data.

## Design Decisions

- **Persistence across reloads:** `localStorage` for the active flag + track ID order; `IndexedDB` (new `demo-tracks` store) for the audio blobs.
- **Mode transitions (enter/exit):** Both trigger `location.reload()` to avoid hot-switching the player between two track sources mid-session.
- **Offline playback:** Dropped files are already local blobs — they're "offline" from the moment they're stored. No download step needed.
- **Isolation:** Demo tracks live in a separate `demo-tracks` IndexedDB store; real cached tracks in `tracks` are never touched.
- **Exit cleanup guarantee:** `exit()` clears the IndexedDB store before removing the localStorage flag and reloading. No demo data persists after exit.

## Storage

### `localStorage` keys
| Key | Value | Purpose |
|-----|-------|---------|
| `kf_demo_active` | `'true'` | Whether demo mode is on |
| `kf_demo_track_ids` | JSON array of UUIDs | Track order (preserved across reloads) |

### IndexedDB
Existing DB `killing-freud-offline`, bumped to version 2:
```
Store: demo-tracks (new)
  keyPath: id (UUID)
  Fields: { id, name, size, blob, addedAt }
```

### Track object shape in demo mode
```js
{ id, name, size, blob, url: null, offlineState: 'demo', _cacheKey: null }
```

## New Files

### `src/js/demo-mode.js`
Single source of truth for demo state.
- `isActive()` — reads `localStorage`
- `enter(files)` — validates files, saves blobs to `demo-tracks` store, writes localStorage, reloads
- `exit()` — clears `demo-tracks` store, removes localStorage keys, reloads
- `getTracks()` — reads IDs from localStorage, fetches blobs from IndexedDB in order, returns track array

### `src/js/drop-zone.js`
Drag-and-drop handling.
- `initDropZone()` — attaches `dragenter`/`dragleave`/`dragover`/`drop` listeners to `document`
- Shows/hides the `#dropOverlay` element during drag
- Filters dropped items: `file.type.startsWith('audio/')` only
- Calls `DemoMode.enter(files)` on valid drop

## Modified Files

### `src/js/offline-storage.js`
- Bump `DB_VERSION` to `2`
- Add `demo-tracks` object store in `onupgradeneeded`
- Export: `saveDemoTrack(track)`, `getAllDemoTracks()`, `clearDemoTracks()`

### `src/js/player.js`
- `init(demoTracks?)` — if `demoTracks` provided, skip API fetch, set `_isDemo = true`
- `playTrack()` — check `track.blob` directly before falling back to `_cacheKey` lookup
- `_renderTracklist()` — omit offline button column and add `is-demo` class on items when in demo mode
- Offline controls (`#offlineControls`) remain hidden in demo mode

### `src/js/main.js`
- Import and init `initDropZone` (always active)
- If `DemoMode.isActive()`: show `#demoBanner`, wire `#demoBannerExit` → `DemoMode.exit()`
- Pass `await DemoMode.getTracks()` into `player.init()` when demo is active

### `src/index.html`
```html
<!-- Demo banner (shown when demo mode is active) -->
<div class="demo-banner" id="demoBanner" hidden>
  <span class="demo-banner__label">DEMO MODE</span>
  <span class="demo-banner__hint">Listening to dropped files</span>
  <button class="demo-banner__exit" id="demoBannerExit" aria-label="Exit demo mode">✕</button>
</div>

<!-- Drop overlay (shown while files are being dragged over the window) -->
<div class="drop-overlay" id="dropOverlay" hidden>
  <div class="drop-overlay__inner">
    <p>Drop audio files to listen</p>
  </div>
</div>
```

### `src/styles.css`
- `--demo-h` CSS variable (default `0px`; set to `36px` via `body.demo-mode`)
- `.demo-banner` — `position: fixed; top: 0` banner
- `.nav` adjusted to `top: var(--demo-h)` so it slides down when banner is visible
- `.drop-overlay` — full-screen fixed overlay, dashed border, high z-index
- `.tracklist__item.is-demo` — `grid-template-columns: 32px 1fr auto` (no offline btn column)

## UX Flow

```
Normal site
  └── user drags files over window
        → #dropOverlay appears
          → user drops audio files
            → files validated (audio/* only)
            → blobs saved to IndexedDB demo-tracks
            → localStorage flag + ID list written
            → location.reload()
              → #demoBanner visible (above nav)
              → player loads demo tracks from IndexedDB (no /api/tracks call)
              → loop / next / prev / offline playback all work on dropped files
                → user clicks ✕ on banner
                  → IndexedDB demo-tracks cleared
                  → localStorage keys removed
                  → location.reload()
                    → normal site, no demo data remains
```

## Files Changed Summary

| File | Change |
|------|--------|
| `src/js/demo-mode.js` | **New** — state, IndexedDB storage, enter/exit |
| `src/js/drop-zone.js` | **New** — drag-and-drop event handling |
| `src/js/offline-storage.js` | Add `demo-tracks` store (DB v2) + CRUD exports |
| `src/js/player.js` | Branch init, direct blob playback, hide offline controls |
| `src/js/main.js` | Init drop zone, show banner, wire exit, pass demo tracks |
| `src/index.html` | Demo banner + drop overlay elements |
| `src/styles.css` | Banner, overlay, demo tracklist, nav offset |
