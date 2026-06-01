/**
 * Netlify Function: tracks
 * GET /api/tracks
 *
 * Returns [{ id, name, size, url }] for all MP3s in the configured folder.
 *
 * Env vars required:
 *   CLOUDINARY_CLOUD_NAME
 *   CLOUDINARY_API_KEY
 *   CLOUDINARY_API_SECRET
 *   CLOUDINARY_TRACKS_FOLDER  (optional)
 */

const { buildAuth, buildPrefix, fetchMp3Resources, cleanFilename } = require('../lib/cloudinary')

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

  try {
    const auth      = buildAuth(CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET)
    const prefix    = buildPrefix(CLOUDINARY_TRACKS_FOLDER)
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
