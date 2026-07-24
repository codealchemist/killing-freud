/**
 * Netlify Function: albums
 * GET /api/albums
 *
 * Returns the public album catalog: [{ slug, title, subtitle, artUrl,
 * hasLyrics, hasSharing }]. Cloudinary folder paths are never exposed here.
 */

const { getPublicAlbums } = require('../lib/albums')

exports.handler = async function (event) {
  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, body: 'Method Not Allowed' }
  }

  return {
    statusCode: 200,
    body: JSON.stringify(getPublicAlbums()),
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'public, max-age=300'
    }
  }
}
