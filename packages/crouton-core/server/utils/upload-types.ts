/**
 * Upload type policy (#3132).
 * Raster images are the only types safe to render inline; everything else is
 * served as an attachment. No HTML, no SVG, no video/audio by default.
 */
export const RASTER_IMAGE_TYPES = [
  'image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/avif'
]

export const DEFAULT_ALLOWED_TYPES = [
  ...RASTER_IMAGE_TYPES,
  'application/pdf',
  // Office
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation'
]
