/**
 * Album catalog: one entry per published album. To add a new album:
 *   1. Append an entry below (bump `order` so it sorts where you want it).
 *   2. Drop the cover image in public/albums/<slug>/cover.jpg and point
 *      `artUrl` at it — it MUST live under public/, not src/. This file
 *      runs as a Netlify Function (plain Node, outside Vite's build), so
 *      it can only return static, unhashed URLs; anything in src/ only
 *      gets a stable URL if Vite's asset pipeline processes it, which
 *      won't happen for a path that's just a string in server code.
 *   3. If the album has lyrics, add src/lyrics/<slug>/*.txt and set
 *      hasLyrics: true (the slug doubles as the lyrics folder name).
 *   4. Set tracksFolder (and sharingFolder, if it has a "Sharing" tab) to
 *      the Cloudinary folder prefix holding that album's tracks.
 *   5. If hasSharing is true, add src/albums/<slug>/sharing.html — the
 *      panel's title/tagline/intro all live in that one HTML fragment
 *      (rendered as HTML, same bundling technique as the lyrics .txt files),
 *      not in this file.
 *
 * `tracksFolder`/`sharingFolder` are Cloudinary folder prefixes. They are not
 * secrets, so new albums can just hardcode a folder string here — the env
 * var fallback below only exists to keep the already-deployed "Shattering
 * Souls" folder working without requiring a Netlify dashboard change.
 */
const CLOUDINARY_TRACKS_FOLDER = process.env.CLOUDINARY_TRACKS_FOLDER
const ALBUMS = [
  {
    slug: 'shattering-souls',
    title: 'Shattering Souls',
    subtitle: 'AI-forged vocals over human-scarred instrumentation.',
    artUrl: '/albums/2026-01-shattering-souls/cover.jpg',
    tracksFolder:
      `${CLOUDINARY_TRACKS_FOLDER}/PR2026-01-shattering-souls/mp3` || '',
    sharingFolder:
      `${CLOUDINARY_TRACKS_FOLDER}/PR2026-01-shattering-souls/mp3-no-vocals` ||
      null,
    // Lyrics for this album live under src/lyrics/<slug>/*.txt — the slug
    // doubles as the lyrics folder name, so no separate field is needed.
    hasLyrics: true,
    hasSharing: true,
    order: 1
  },
  {
    slug: 'normal-day',
    title: 'Normal Day',
    subtitle:
      'Back to the roots with Logic Pro drums and everything else human played.',
    artUrl: '/albums/2026-02-normal-day/cover.jpg',
    tracksFolder: `${CLOUDINARY_TRACKS_FOLDER}/PR2026-04-normal-day/mp3` || '',
    sharingFolder:
      `${CLOUDINARY_TRACKS_FOLDER}/PR2026-04-normal-day/mp3-no-guitar` || null,
    hasLyrics: false,
    hasSharing: true,
    // TODO(band): placeholder copy in src/albums/normal-day/sharing.html —
    // write the real pitch for this album.
    order: 2
  }
]

function getAllAlbums() {
  return ALBUMS.slice().sort((a, b) => a.order - b.order)
}

// Public-safe projection served by /api/albums — never includes Cloudinary
// folder paths.
function getPublicAlbums() {
  return getAllAlbums().map(
    ({ slug, title, subtitle, artUrl, hasLyrics, hasSharing }) => ({
      slug,
      title,
      subtitle,
      artUrl,
      hasLyrics,
      hasSharing
    })
  )
}

function getAlbumBySlug(slug) {
  return ALBUMS.find(a => a.slug === slug) || null
}

module.exports = { getAllAlbums, getPublicAlbums, getAlbumBySlug }
