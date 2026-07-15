/**
 * Netlify Function: tracks
 * GET /api/tracks?album=<slug>
 *
 * Returns [{ id, name, size, url }] for all MP3s in the given album's
 * Cloudinary folder. If `album` is omitted, falls back to the legacy
 * single-album CLOUDINARY_TRACKS_FOLDER env var for backward compatibility.
 *
 * Env vars required:
 *   CLOUDINARY_CLOUD_NAME
 *   CLOUDINARY_API_KEY
 *   CLOUDINARY_API_SECRET
 *   CLOUDINARY_TRACKS_FOLDER  (optional, legacy fallback)
 */

const { buildAuth, buildPrefix, fetchMp3Resources, cleanFilename } = require('../lib/cloudinary')
const { getAlbumBySlug } = require('../lib/albums')

exports.handler = async function (event) {
  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, body: 'Method Not Allowed' }
  }

  const { CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET, CLOUDINARY_TRACKS_FOLDER } = process.env

  if (!CLOUDINARY_CLOUD_NAME || !CLOUDINARY_API_KEY || !CLOUDINARY_API_SECRET) {
    console.error('tracks: missing Cloudinary credentials')
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Server configuration error' }),
      headers: { 'Content-Type': 'application/json' }
    }
  }

  const albumSlug = event.queryStringParameters?.album
  let folder = CLOUDINARY_TRACKS_FOLDER

  if (albumSlug) {
    const album = getAlbumBySlug(albumSlug)
    if (!album) {
      return {
        statusCode: 404,
        body: JSON.stringify({ error: 'Unknown album' }),
        headers: { 'Content-Type': 'application/json' }
      }
    }
    folder = album.tracksFolder
  }

  try {
    const auth      = buildAuth(CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET)
    const prefix    = buildPrefix(folder)
    const resources = await fetchMp3Resources(CLOUDINARY_CLOUD_NAME, auth, prefix)

    const tracks = resources.map(r => ({
      id:   r.public_id,
      name: cleanFilename(r.original_filename || r.filename || r.public_id, r.public_id, r.format),
      size: r.bytes,
      url:  r.secure_url,
    }))

    return {
      statusCode: 200,
      body: JSON.stringify(tracks),
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'private, no-store' }
    }
  } catch (err) {
    console.error('tracks:', err.message, err.body ?? '')
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Internal server error' }),
      headers: { 'Content-Type': 'application/json' }
    }
  }
}
