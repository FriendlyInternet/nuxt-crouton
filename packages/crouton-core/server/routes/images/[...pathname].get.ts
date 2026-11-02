import { RASTER_IMAGE_TYPES } from '../../utils/upload-types'

export default eventHandler(async (event) => {
  const { pathname } = event.context.params || {}
  if (!pathname) {
    throw createError({ status: 400, statusText: 'Pathname is required' })
  }

  // Set cache headers for edge caching (1 year, immutable since filenames have random suffixes)
  setResponseHeaders(event, {
    'Cache-Control': 'public, max-age=31536000, immutable',
    'CDN-Cache-Control': 'public, max-age=31536000, immutable',
    'X-Content-Type-Options': 'nosniff'
  })

  // Only raster images render inline; everything else (pdf, svg, html...) downloads
  let contentType: string | undefined
  try {
    contentType = (await blob.head(pathname)).contentType
  } catch (error: unknown) {
    const code = (error as { statusCode?: number, status?: number }).statusCode ?? (error as { status?: number }).status
    if (code === 404) throw createError({ status: 404, statusText: 'Not found' })
    throw error
  }
  if (!contentType || !RASTER_IMAGE_TYPES.includes(contentType.split(';')[0]!.trim().toLowerCase())) {
    setResponseHeader(event, 'Content-Disposition', 'attachment')
  }

  return blob.serve(event, pathname)
})
