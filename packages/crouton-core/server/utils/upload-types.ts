/**
 * Upload type policy (#3132).
 * Raster images are the only types safe to render inline; everything else is
 * served as an attachment. SVG is allowed (team favicon/logo) but only ever served
 * sandboxed + as an attachment (see SVG_SERVE_HEADERS). No HTML, no video/audio.
 */
export const RASTER_IMAGE_TYPES = [
  'image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/avif'
]

export const SVG_TYPE = 'image/svg+xml'

/** Headers that neutralise scripts in an SVG opened directly; <img> rendering is unaffected. */
export const SVG_SERVE_HEADERS = {
  'Content-Security-Policy': "sandbox; default-src 'none'; style-src 'unsafe-inline'; img-src data:",
  'X-Content-Type-Options': 'nosniff',
  'Content-Disposition': 'attachment'
}

export const DEFAULT_ALLOWED_TYPES = [
  ...RASTER_IMAGE_TYPES,
  SVG_TYPE,
  'application/pdf',
  // Office
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation'
]
