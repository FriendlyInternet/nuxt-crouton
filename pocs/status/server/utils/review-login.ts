import { createHash } from 'node:crypto'

// Mirrors the "Seed review login" step in .github/workflows/deploy-app.yml — keep in sync.
export function reviewLogin(secret: string, app: string, key: string) {
  const password = createHash('sha256').update(`${secret}:${app}:${key}`).digest('hex').slice(0, 24)
  return { email: `review+${app}-${key}@example.com`, password }
}

export function reviewLoginUrl(baseUrl: string, secret: string, app: string, key: string, redirect = ''): string {
  const { email, password } = reviewLogin(secret, app, key)
  const q = new URLSearchParams({ email, password })
  if (redirect) q.set('redirect', redirect)
  return `${baseUrl.replace(/\/+$/, '')}/auth/login?${q}`
}

// Preview-only sign-in token (#2700): lets CI capture a screenshot of a PR preview even though
// this app has no password to sign in with. Mirrors previewSessionToken in
// scripts/lib/review-login.mjs — keep in sync.
export function previewSessionToken(secret: string, app: string, key: string): string {
  return createHash('sha256').update(`${secret}:${app}:preview-session:${key}`).digest('hex').slice(0, 32)
}
