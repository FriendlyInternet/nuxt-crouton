import { isSafePath } from './totest-core'

/** `martin@example.eu` → `m•••@•••.eu` — a hint, never the address. */
export function maskEmail(email: string): string {
  const at = email.lastIndexOf('@')
  if (at < 1) return '•••'
  const first = email[0]
  const tld = email.slice(email.lastIndexOf('.') + 1)
  return `${first}•••@•••.${tld && email.lastIndexOf('.') > at ? tld : '•••'}`
}

/** Where the link should land: the requested path if it is a safe app path, else `/`. */
export function safeRedirect(redirect: unknown): string {
  return isSafePath(redirect) ? redirect : '/'
}

/** One link per `windowMs` per key. Returns true when the send is allowed (and records it). */
export function createRateLimiter(windowMs = 60_000, now: () => number = Date.now) {
  const last = new Map<string, number>()
  return (key: string): boolean => {
    const t = now()
    const prev = last.get(key)
    if (prev !== undefined && t - prev < windowMs) return false
    last.set(key, t)
    return true
  }
}
