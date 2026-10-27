import { createHash } from 'node:crypto'

// Mirrors the "Seed review login" step in .github/workflows/deploy-app.yml — keep in sync.
export function reviewLogin(secret: string, app: string, key: string) {
  const password = createHash('sha256').update(`${secret}:${app}:${key}`).digest('hex').slice(0, 24)
  return { email: `review+${app}-${key}@example.com`, password }
}

// The `walk` param is the base64url JSON crouton-feedback's Spec walk reads (no secrets).
// Anything that isn't base64url, or is over ~2 KB, is dropped rather than forwarded.
export function sanitizeWalk(raw: unknown): string | null {
  return typeof raw === 'string' && raw.length <= 2048 && /^[A-Za-z0-9_-]+={0,2}$/.test(raw) ? raw : null
}

/** Adds `walk` to a same-app path (keeps any query it already has). */
export function withWalk(path: string, walk?: string | null): string {
  if (!walk) return path
  return `${path || '/'}${(path || '/').includes('?') ? '&' : '?'}${new URLSearchParams({ walk })}`
}

export function reviewLoginUrl(baseUrl: string, secret: string, app: string, key: string, redirect = '', walk?: string | null): string {
  const { email, password } = reviewLogin(secret, app, key)
  const q = new URLSearchParams({ email, password })
  const target = withWalk(redirect, walk)
  if (target) q.set('redirect', target)
  return `${baseUrl.replace(/\/+$/, '')}/auth/login?${q}`
}
