// One redirect check for the whole status app (sign-in page, sign-in link, review login).
// Not under shared/utils, so it is not auto-imported; import it explicitly.

/**
 * Longest sign-in return path accepted (#3840). The login route's signed-out back path carries
 * `to` (<= 500, up to 3x when URL-encoded) plus a card walk (<= 2048), so 500 dropped real links.
 */
export const REDIRECT_MAX = 4096

/** A redirect target is safe only as a same-origin absolute path: `/x`, never `//host`, `\\`, or a scheme. */
export function isSafePath(to: unknown, max = 500): to is string {
  return typeof to === 'string'
    && to.length <= max
    && /^\/(?!\/)/.test(to)
    && !/[\\\u0000-\u001f\u007f]/.test(to)
}

/** Only same-site relative paths survive; anything else falls back to `/`. */
export function safeRedirect(raw: unknown): string {
  return isSafePath(raw, REDIRECT_MAX) ? raw : '/'
}
