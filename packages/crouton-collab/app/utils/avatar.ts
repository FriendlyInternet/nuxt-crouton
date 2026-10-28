/**
 * Get user initials from display name.
 * Returns first and last initial for multi-word names, single initial otherwise.
 */
export function getInitials(name: string): string {
  if (!name) return '?'
  const parts = name.trim().split(/\s+/)
  const first = parts[0] ?? ''
  if (parts.length === 1) {
    return first.charAt(0).toUpperCase()
  }
  const last = parts[parts.length - 1] ?? ''
  return (first.charAt(0) + last.charAt(0)).toUpperCase()
}

/**
 * Generate a consistent HSL color from a user ID.
 * Polynomial hash (ids differing in the last char hash to consecutive integers), then a
 * golden-angle step so near-identical ids (u1/u2) land on well-separated hues.
 */
export function generateUserColor(userId: string): string {
  let h = 0
  for (let i = 0; i < userId.length; i++) {
    h = (Math.imul(h, 31) + userId.charCodeAt(i)) >>> 0
  }
  const hue = Math.round((h * 137.508) % 360)
  return `hsl(${hue}, 65%, 45%)`
}

/**
 * Get readable text color based on background luminance.
 * Accepts #rrggbb or hsl(h, s%, l%). Returns dark text for light backgrounds, white otherwise.
 */
export function getTextColor(bgColor: string): string {
  const hsl = bgColor.match(/^hsla?\(\s*[\d.]+\s*,\s*[\d.]+%\s*,\s*([\d.]+)%/i)
  if (hsl) return Number(hsl[1]) > 60 ? '#1f2937' : 'white'

  const hex = bgColor.replace('#', '')
  if (hex.length !== 6) return 'white'

  const r = parseInt(hex.slice(0, 2), 16)
  const g = parseInt(hex.slice(2, 4), 16)
  const b = parseInt(hex.slice(4, 6), 16)

  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255
  return luminance > 0.5 ? '#1f2937' : 'white'
}
