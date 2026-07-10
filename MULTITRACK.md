# Multitrack Editor Plan — trackswitch.js

## Executive Summary

A new "Multitrack" section lets a user drop audio files to build a synchronized multitrack
session: solo/mute/volume/pan per track, waveform display, playback synced across all tracks.
Sessions are named, persisted to IndexedDB automatically (no explicit save), and can be shared
peer-to-peer using the same WebRTC flow already built for DEMO mode sharing — generalized to
carry a `kind` (`demo` | `multitrack`) and per-track mixer metadata instead of just album name.

Playback engine: [`trackswitch`](https://github.com/audiolabs/trackswitch.js) v2 (npm package
`trackswitch`), a modern ESM rewrite (no jQuery). It is a synchronized multitrack **player/mixer**
— solo, mute, volume, pan, waveform — not a waveform trim/cut editor. That is the intended scope
here; no audio content editing (trim/reorder) is included.

---

## Why trackswitch.js Fits

Inspected the actual npm package (`trackswitch@2.0.1`) types directly:

- Pure ESM, no jQuery dependency (unlike the old v0.x jQuery-plugin version).
- `createDefaultTrackSwitch(rootElement, init)` returns a `TrackSwitchController`:
  `load()`, `play/pause/stop/seekTo`, `setTrackVolume`, `setTrackPan`, `toggleSolo`,
  `updateConfig(nextInit)`, `on(eventName, handler)` for `'loaded' | 'error' | 'position' | 'trackState'`.
- `updateConfig()` pushes a new track list into a **live** instance — no destroy/recreate needed
  when tracks are added or removed. This is the key capability that makes "drop more files to
  add tracks" clean to implement.
- Tracks are plain objects: `{ title, sources: [{ src, type }], volume, pan, solo }` inside a
  `trackGroup` UI element. `src` accepts a blob URL directly — no upload/server round-trip.
- Ships waveform rendering, per-track solo/volume/pan, looping, keyboard shortcuts, and iOS audio
  unlock handling built in.
- No separate CSS asset to wire up — styling is injected by the library itself.

---

## Data Model

Extend the existing `killing-freud-offline` IndexedDB database (currently v2, stores `tracks` +
`demo-tracks` — see `src/js/offline-storage.js`) to v3 with two new object stores:

```
multitrack-sessions
  { id, name, trackOrder: [trackId, ...],
    trackState: { [trackId]: { volume, pan, solo } },
    createdAt, updatedAt }

multitrack-tracks
  { id, sessionId, name, size, blob, addedAt }
  — index on `sessionId` for "all tracks in session" / cascade delete
```

Every mutation (add track, remove track, rename session, change volume/pan/solo) writes through
to IndexedDB immediately. No explicit save button — matches "persisted to IndexedDB by default."

---

## New Modules

### `src/js/multitrack-storage.js`
CRUD on the two new stores, same shape as `offline-storage.js`:
`createSession(name)`, `listSessions()`, `renameSession(id, name)`, `deleteSession(id)`
(cascades track deletion via the `sessionId` index), `addTracksToSession(id, files)`,
`removeTrackFromSession(id, trackId)`, `getSessionTracks(id)`,
`updateTrackState(id, trackId, { volume?, pan?, solo? })` (debounced).

### `src/js/multitrack-player.js`
Wraps the trackswitch.js controller:
- Builds `TrackSwitchInit` from a session's tracks (blob URLs + persisted volume/pan/solo).
- Maintains `Map<trackId, blobURL>`; revokes URLs on track removal / session close to avoid leaks.
- `addTracks(files)` / `removeTrack(id)` call `controller.updateConfig()` on the live instance.
- Listens for the `trackState` event and persists volume/pan/solo back to storage.
- `destroy()` — tears down controller + revokes all outstanding blob URLs.

### `src/js/multitrack-ui.js`
Orchestrates the `#multitrack` section:
- **List view**: session cards (name, track count, updated date), "New Session" button.
- **Editor view**: editable session name (reusing the inline-edit pattern already used for the
  demo album name in `main.js`), drop hint, "+ Add tracks" file-input fallback, the trackswitch
  mount point, Share button, back/delete controls.
- Wires the mode-aware drop zone and the share button to the storage + player modules.

---

## Drop-to-Add-Tracks

`src/js/drop-zone.js` is currently a single document-level listener that unconditionally calls
`DemoMode.enter()` (replacing tracks) on drop. It becomes mode-aware: while `document.body` has a
`multitrack-mode` class (set when the editor view is open), dropped files are routed to
`addTracksToSession` (append) instead of demo mode (replace) — one listener, branch on mode,
rather than two competing document-level listeners.

---

## Sharing — Reusing the DEMO Share Feature

No backend changes. `/api/signal` and Netlify Blobs already move opaque JSON payloads, so this is
entirely a client-side protocol generalization.

- `demo-share.js`'s `MANIFEST` message goes from `{ albumName, files }` to
  `{ kind: 'demo' | 'multitrack', name, metadata, files }`, where for multitrack, `metadata`
  carries `trackOrder` + per-track volume/pan/solo so the receiver's mixer opens in the same state
  as the sender's — not just the raw audio files. Backward-compatible: old `albumName` field still
  read as a fallback.
- `demo-share-ui.js`'s `_openShareModal` / `initIncomingSession` are generalized to accept a config
  object (`tracks`, `name`, `art`, `metadata`, `kind`) instead of hardcoding demo-mode assumptions
  — reusing the existing modal/QR/progress-bar markup and logic rather than forking a second copy.
- Share URL gains a `kind` param (`?share=ROOM&kind=multitrack`) so the receiving `main.js` knows
  which importer to run before the WebRTC handshake completes.
- On receive, `kind === 'multitrack'` creates a new session via `multitrack-storage.js`, saves
  files + metadata, then opens it — reusing the same reload-after-save pattern `demo-mode.js`
  already uses, rather than inventing a new hot-state-swap path.

---

## Files Summary

| File | Change | Purpose |
|---|---|---|
| `src/js/multitrack-storage.js` | **New** | Session/track CRUD on IndexedDB |
| `src/js/multitrack-player.js` | **New** | trackswitch.js controller wrapper |
| `src/js/multitrack-ui.js` | **New** | Section orchestration, list/editor views |
| `src/js/offline-storage.js` | Modify | Bump `DB_VERSION` to 3, add two stores + index |
| `src/js/drop-zone.js` | Modify | Mode-aware routing (demo vs. multitrack) |
| `src/js/demo-share.js` | Modify | Generic `kind`/`metadata` payload |
| `src/js/demo-share-ui.js` | Modify | Parameterize modal/overlay by config |
| `src/js/main.js` | Modify | Mount multitrack section, route share param by `kind` |
| `src/index.html` | Modify | Nav link, `#multitrack` markup |
| `src/styles.css` | Modify | Section/card/editor styles |
| `package.json` | Modify | Add `trackswitch` dependency (no jQuery) |

---

## Implementation Phases

### Phase 1 — Storage + scaffold
- `multitrack-storage.js`, `offline-storage.js` v3 migration
- `#multitrack` nav link + section markup (list view: create/rename/delete, no player yet)

### Phase 2 — Player integration
- `multitrack-player.js`, mount trackswitch.js against a static session's tracks
- Verify waveform/solo/volume/pan work off blob URLs

### Phase 3 — Drop-to-add + live editing
- Mode-aware drop zone, add/remove tracks, autosave, per-track state persistence

### Phase 4 — Sharing
- Generalize `demo-share.js` payload + `demo-share-ui.js` modal
- Verify full round-trip between two tabs/devices

### Phase 5 — Polish
- Empty states, mobile layout, storage-quota/perf edge cases

---

## Risks

| Risk | Note |
|---|---|
| Memory use | trackswitch.js decodes full audio into `AudioBuffer`s client-side for waveform + sync playback; scales with track count × duration. May need a soft cap/warning. |
| Bundle size | `trackswitch` depends on `d3`, `opensheetmusicdisplay`, `papaparse`. Its build ships pre-chunked ESM (sheet-music/alignment paths unused here) — confirm Vite tree-shakes them after install. |
| Blob URL leaks | Must revoke every `URL.createObjectURL` on track removal / session close. |
| Share protocol change | `MANIFEST` payload shape change must stay backward-compatible with any already-shared demo links mid-flight (low risk — signal TTL is 5 min). |
