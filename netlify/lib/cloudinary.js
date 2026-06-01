const CLOUDINARY_BASE = 'https://api.cloudinary.com/v1_1'

function buildAuth(apiKey, apiSecret) {
  return Buffer.from(`${apiKey}:${apiSecret}`).toString('base64')
}

function buildPrefix(folder) {
  if (!folder) return ''
  return encodeURIComponent(folder.replace(/\/$/, '')) + '/'
}

async function fetchMp3Resources(cloudName, auth, prefix) {
  const qs = `max_results=500${prefix ? `&prefix=${prefix}` : ''}`

  const [rawRes, videoRes] = await Promise.all([
    fetch(`${CLOUDINARY_BASE}/${cloudName}/resources/raw/upload?${qs}`,   { headers: { Authorization: `Basic ${auth}` } }),
    fetch(`${CLOUDINARY_BASE}/${cloudName}/resources/video/upload?${qs}`, { headers: { Authorization: `Basic ${auth}` } }),
  ])

  const [rawData, videoData] = await Promise.all([
    rawRes.ok   ? rawRes.json()   : Promise.resolve({ resources: [] }),
    videoRes.ok ? videoRes.json() : Promise.resolve({ resources: [] }),
  ])

  if (!rawRes.ok)   console.error('cloudinary: raw endpoint error',   rawRes.status)
  if (!videoRes.ok) console.error('cloudinary: video endpoint error', videoRes.status)

  return [...(rawData.resources ?? []), ...(videoData.resources ?? [])].filter(
    r => r.bytes > 0 && (r.format === 'mp3' || r.secure_url?.endsWith('.mp3'))
  )
}

function cleanFilename(rawName, publicId, format) {
  let name = rawName || publicId || ''
  try { name = decodeURIComponent(name) } catch { /* ignore */ }

  // Keep only the last path segment
  name = name.split(/[\\/]/).pop().trim()
  // Normalise separators
  name = name.replace(/_+/g, ' ').replace(/\s+/g, ' ').trim()
  name = name.replace(/-+/g, '-')

  const extMatch = name.match(/(.*?)(\.[^.]+)$/)
  let base = extMatch ? extMatch[1] : name
  const ext = extMatch ? extMatch[2] : format ? `.${format}` : ''

  // Strip the Cloudinary-appended 6-char public-id suffix
  base = base.length > 6 ? base.slice(0, -6).trim() : ''
  return base + ext
}

module.exports = { buildAuth, buildPrefix, fetchMp3Resources, cleanFilename }
