/**
 * Netlify Function: gallery (Cloudinary)
 * GET /api/gallery
 *
 * Lists image files stored in Cloudinary and returns [{ id, name, url }].
 *
 * Env vars required:
 *   CLOUDINARY_CLOUD_NAME
 *   CLOUDINARY_API_KEY
 *   CLOUDINARY_API_SECRET
 *   CLOUDINARY_GALLERY_FOLDER (optional prefix)
 */

const CLOUDINARY_BASE = 'https://api.cloudinary.com/v1_1'
const IMAGE_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.webp', '.gif']

exports.handler = async function (event) {
  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, body: 'Method Not Allowed' }
  }

  const {
    CLOUDINARY_CLOUD_NAME,
    CLOUDINARY_API_KEY,
    CLOUDINARY_API_SECRET,
    CLOUDINARY_GALLERY_FOLDER
  } = process.env

  if (!CLOUDINARY_CLOUD_NAME || !CLOUDINARY_API_KEY || !CLOUDINARY_API_SECRET) {
    console.error('Missing Cloudinary configuration environment variables')
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Server configuration error' }),
      headers: { 'Content-Type': 'application/json' }
    }
  }

  console.debug('gallery: env loaded', {
    CLOUDINARY_CLOUD_NAME: !!CLOUDINARY_CLOUD_NAME,
    CLOUDINARY_GALLERY_FOLDER: CLOUDINARY_GALLERY_FOLDER || null
  })

  try {
    const auth = Buffer.from(
      `${CLOUDINARY_API_KEY}:${CLOUDINARY_API_SECRET}`
    ).toString('base64')
    const prefix = CLOUDINARY_GALLERY_FOLDER
      ? `${encodeURIComponent(CLOUDINARY_GALLERY_FOLDER)}`
      : ''
    const url = `${CLOUDINARY_BASE}/${CLOUDINARY_CLOUD_NAME}/resources/image/upload?max_results=500${prefix ? `&prefix=${prefix}` : ''}`
    console.debug('gallery: Cloudinary request', {
      url,
      prefix: CLOUDINARY_GALLERY_FOLDER ? '<provided>' : '<none>'
    })

    const response = await fetch(url, {
      headers: { Authorization: `Basic ${auth}` }
    })

    if (!response.ok) {
      const text = await response.text()
      console.error('Cloudinary API error', response.status, text)
      return {
        statusCode: response.status,
        body: JSON.stringify({ error: 'Cloudinary API error', details: text }),
        headers: { 'Content-Type': 'application/json' }
      }
    }

    const data = await response.json()
    const resources = data.resources || []
    console.debug('gallery: Cloudinary response', {
      resourcesCount: resources.length,
      first: resources[0] && resources[0].public_id
    })

    const images = resources
      .filter(r => {
        const lower = (r.format || '').toLowerCase()
        return (
          IMAGE_EXTENSIONS.includes(`.${lower}`) ||
          (r.secure_url &&
            IMAGE_EXTENSIONS.some(ext => r.secure_url.endsWith(ext)))
        )
      })
      .map(r => ({
        id: r.public_id,
        name: `${r.public_id}.${r.format}`,
        url: r.secure_url
      }))

    console.debug('gallery: mapped images', { imagesCount: images.length })

    return {
      statusCode: 200,
      body: JSON.stringify(images),
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'private, no-store'
      }
    }
  } catch (err) {
    console.error('gallery function error:', err)
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Internal server error' }),
      headers: { 'Content-Type': 'application/json' }
    }
  }
}
