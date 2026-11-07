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

export { safeRedirect } from '../../shared/safe-path'

/** Global cap: at most this many links per clock hour across all visitors. */
export const SIGNIN_LINK_GLOBAL_MAX = 10
export const SIGNIN_LINK_GLOBAL_WINDOW_MS = 3_600_000

/** KV keys: per client IP (null when unknown, so no shared fallback counter) and the hourly global count. */
export function signinLimitKeys(ip: string | null, now: number): { ip: string | null, global: string } {
  return {
    ip: ip ? `status:signin-link:ip:${ip}` : null,
    global: `status:signin-link:global:${Math.floor(now / SIGNIN_LINK_GLOBAL_WINDOW_MS)}`
  }
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
