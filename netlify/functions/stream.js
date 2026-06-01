/**
 * Netlify Function: stream (Cloudinary)
 * GET /api/stream?id={public_id}
 *
 * Returns JSON: { url: "https://..." }

 *   CLOUDINARY_API_KEY
 *   CLOUDINARY_API_SECRET
 */

const CLOUDINARY_BASE = 'https://api.cloudinary.com/v1_1'

exports.handler = async function (event) {
  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, body: 'Method Not Allowed' }
  }

  const fileId = event.queryStringParameters?.id
  if (!fileId) {
    return {
      statusCode: 400,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Missing required query parameter: id' })
    }
  }

  const { CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET } =
    process.env
  if (!CLOUDINARY_CLOUD_NAME || !CLOUDINARY_API_KEY || !CLOUDINARY_API_SECRET) {
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Missing Cloudinary configuration' })
    }
  }

  console.debug('stream: env loaded', {
    CLOUDINARY_CLOUD_NAME: !!CLOUDINARY_CLOUD_NAME
  })

  try {
    const auth = Buffer.from(
      `${CLOUDINARY_API_KEY}:${CLOUDINARY_API_SECRET}`
    ).toString('base64')
    const url = `${CLOUDINARY_BASE}/${CLOUDINARY_CLOUD_NAME}/resources/raw/upload?prefix=${encodeURIComponent(fileId)}&max_results=1`
    console.debug('stream: Cloudinary request', { url, fileId })
    const response = await fetch(url, {
      headers: { Authorization: `Basic ${auth}` }
    })

    if (!response.ok) {
      const text = await response.text()
      console.error('Cloudinary API error', response.status, text)
      return {
        statusCode: response.status,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Cloudinary API error', details: text })
      }
    }

    const data = await response.json()
    const resource = (data.resources || [])[0]
    console.debug('stream: Cloudinary response', {
      resourcesCount: (data.resources || []).length,
      resourceId: resource && resource.public_id
    })
    if (!resource) {
      return {
        statusCode: 404,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'File not found' })
      }
    }

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'private, max-age=30'
      },
      body: JSON.stringify({ url: resource.secure_url })
    }
  } catch (err) {
    console.error('stream function error:', err)
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Internal server error' })
    }
  }
}
