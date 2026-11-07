// One redirect check for the whole status app (sign-in page, sign-in link, review login).
// Not under shared/utils, so it is not auto-imported; import it explicitly.

/** A redirect target is safe only as a same-origin absolute path: `/x`, never `//host`, `\\`, or a scheme. */
export function isSafePath(to: unknown): to is string {
  return typeof to === 'string'
    && to.length <= 500
    && /^\/(?!\/)/.test(to)
    && !/[\\\u0000-\u001f\u007f]/.test(to)
}

/** Only same-site relative paths survive; anything else falls back to `/`. */
export function safeRedirect(raw: unknown): string {
  return isSafePath(raw) ? raw : '/'
}
