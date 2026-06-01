/**
 * Netlify Function: config
 * GET /api/config
 *
 * Returns public site configuration (social links, etc.).
 * Does NOT expose sensitive env vars.
 */

exports.handler = async function (event) {
  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, body: 'Method Not Allowed' }
  }

  const {
    SOCIAL_INSTAGRAM,
    SOCIAL_SPOTIFY,
    SOCIAL_YOUTUBE,
    SOCIAL_EMAIL,
    SITE_TITLE,
    SITE_DESCRIPTION,
    SITE_URL,
    SITE_OG_IMAGE,
    SITE_THEME_COLOR
  } = process.env

  const config = {
    social: {
      instagram: SOCIAL_INSTAGRAM || null,
      spotify: SOCIAL_SPOTIFY || null,
      youtube: SOCIAL_YOUTUBE || null,
      email: SOCIAL_EMAIL || null
    },
    site: {
      title: SITE_TITLE || 'Killing Freud',
      description: SITE_DESCRIPTION || 'Killing Freud — Official website',
      url: SITE_URL || null,
      ogImage: SITE_OG_IMAGE || '/images/og-default.jpg',
      themeColor: SITE_THEME_COLOR || '#0d0d0d'
    }
  }

  return {
    statusCode: 200,
    body: JSON.stringify(config),
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'public, max-age=300'
    }
  }
}
