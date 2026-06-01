/**
 * Netlify Function: sharing
 * GET /api/sharing
 *
 * Returns [{ id, name, size, downloadUrl }] for MP3s in the sharing folder.
 * downloadUrl uses Cloudinary's fl_attachment flag to trigger a browser download.
 *
 * Env vars required:
 *   CLOUDINARY_CLOUD_NAME
 *   CLOUDINARY_API_KEY
 *   CLOUDINARY_API_SECRET
 *   CLOUDINARY_SHARING_TRACKS_FOLDER  (required — no folder, no tracks)
 */

const { buildAuth, buildPrefix, fetchMp3Resources, cleanFilename } = require('../lib/cloudinary')

function toDownloadUrl(secureUrl) {
  return secureUrl.replace('/upload/', '/upload/fl_attachment/')
}

exports.handler = async function (event) {
  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, body: 'Method Not Allowed' }
  }

  const { CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET, CLOUDINARY_SHARING_TRACKS_FOLDER } = process.env

  if (!CLOUDINARY_CLOUD_NAME || !CLOUDINARY_API_KEY || !CLOUDINARY_API_SECRET) {
    console.error('sharing: missing Cloudinary credentials')
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Server configuration error' }),
      headers: { 'Content-Type': 'application/json' }
    }
  }

  if (!CLOUDINARY_SHARING_TRACKS_FOLDER) {
    return {
      statusCode: 200,
      body: JSON.stringify([]),
      headers: { 'Content-Type': 'application/json' }
    }
  }

  try {
    const auth      = buildAuth(CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET)
    const prefix    = buildPrefix(CLOUDINARY_SHARING_TRACKS_FOLDER)
    const resources = await fetchMp3Resources(CLOUDINARY_CLOUD_NAME, auth, prefix)

    const tracks = resources.map(r => ({
      id:          r.public_id,
      name:        cleanFilename(r.original_filename || r.filename || r.public_id, r.public_id, r.format),
      size:        r.bytes,
      downloadUrl: toDownloadUrl(r.secure_url),
    }))

    return {
      statusCode: 200,
      body: JSON.stringify(tracks),
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'private, no-store' }
    }
  } catch (err) {
    console.error('sharing:', err.message, err.body ?? '')
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Internal server error' }),
      headers: { 'Content-Type': 'application/json' }
    }
  }
}
