import { createHash } from 'node:crypto'

// Mirrors the "Seed review login" step in .github/workflows/deploy-app.yml — keep in sync.
export function reviewLogin(secret: string, app: string, key: string) {
  const password = createHash('sha256').update(`${secret}:${app}:${key}`).digest('hex').slice(0, 24)
  return { email: `review+${app}-${key}@example.com`, password }
}

export function reviewLoginUrl(baseUrl: string, secret: string, app: string, key: string): string {
  const { email, password } = reviewLogin(secret, app, key)
  const q = new URLSearchParams({ email, password })
  return `${baseUrl.replace(/\/+$/, '')}/auth/login?${q}`
}
