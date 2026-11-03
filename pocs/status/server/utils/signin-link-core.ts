// Pure helpers for the one-button owner sign-in (/signin). No Nitro imports, so unit-testable.

/** Minimum gap between two link requests. */
export const SIGNIN_LINK_INTERVAL_MS = 60_000

/** `maarten@example.eu` -> `m•••@•••.eu`. Never reveals the local part or the domain name. */
export function maskEmail(email: string): string {
  const at = email.lastIndexOf('@')
  if (at < 1) return '•••'
  const first = email[0]
  const tld = email.slice(email.lastIndexOf('.') + 1)
  const hasTld = email.lastIndexOf('.') > at && tld.length > 0
  return `${first}•••@•••${hasTld ? `.${tld}` : ''}`
}

/** Only same-site relative paths survive; anything else falls back to `/`. */
export function safeRedirect(raw: unknown): string {
  const s = typeof raw === 'string' ? raw : ''
  if (!s.startsWith('/') || s.startsWith('//') || s.includes('\\') || /[\r\n]/.test(s)) return '/'
  return s
}

/** Whether a request at `now` is allowed given the last send time (ms) or null. */
export function rateLimitOk(last: number | null, now: number, interval = SIGNIN_LINK_INTERVAL_MS): boolean {
  return last === null || now - last >= interval
}

/** Send the magic link via the auth api; a clear 501 when the magic-link plugin is not enabled. */
export async function sendSignInLink(
  api: { signInMagicLink?: (opts: { body: { email: string, callbackURL: string }, headers: Headers }) => Promise<unknown> },
  opts: { email: string, callbackURL: string, headers: Headers }
): Promise<void> {
  if (typeof api.signInMagicLink !== 'function') {
    throw Object.assign(new Error('Magic-link sign-in is not enabled on this build.'), { statusCode: 501 })
  }
  await api.signInMagicLink({ body: { email: opts.email, callbackURL: opts.callbackURL }, headers: opts.headers })
}
