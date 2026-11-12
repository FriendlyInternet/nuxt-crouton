import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { previewSessionToken, reviewLogin, reviewLoginUrl } from '../server/utils/review-login'

describe('reviewLogin', () => {
  it('matches the deploy derivation (sha256 of secret:app:key, first 24 hex)', () => {
    const expected = createHash('sha256').update('s3cret:velo:main').digest('hex').slice(0, 24)
    expect(reviewLogin('s3cret', 'velo', 'main')).toEqual({
      email: 'review+velo-main@example.com',
      password: expected
    })
    expect(expected).toHaveLength(24)
  })

  it('differs per app, key and secret', () => {
    const a = reviewLogin('s', 'velo', 'main').password
    expect(reviewLogin('s', 'kassa', 'main').password).not.toBe(a)
    expect(reviewLogin('s', 'velo', 'pr1').password).not.toBe(a)
    expect(reviewLogin('t', 'velo', 'main').password).not.toBe(a)
  })

  it('builds the /auth/login URL with encoded email and password', () => {
    const { password } = reviewLogin('s', 'velo', 'main')
    expect(reviewLoginUrl('https://velo.pmcp.dev/', 's', 'velo', 'main'))
      .toBe(`https://velo.pmcp.dev/auth/login?email=review%2Bvelo-main%40example.com&password=${password}`)
  })

  it('adds redirect when given', () => {
    expect(new URL(reviewLoginUrl('https://v.dev', 's', 'velo', 'main', '/admin?a=1')).searchParams.get('redirect')).toBe('/admin?a=1')
  })
})

describe('previewSessionToken', () => {
  it('matches the CI derivation (sha256 of secret:app:preview-session:key, first 32 hex)', () => {
    const expected = createHash('sha256').update('s:status:preview-session:pr7').digest('hex').slice(0, 32)
    expect(previewSessionToken('s', 'status', 'pr7')).toBe(expected)
  })
})

describe('signedOutBackPath (#3840)', async () => {
  const { signedOutBackPath } = await import('../server/utils/review-login')
  const parse = (p: string) => new URL(p, 'http://h')

  it('keeps a PR key and a safe page path', () => {
    const u = parse(signedOutBackPath('velo', { key: 'pr3805', to: '/admin/x' }))
    expect(u.pathname).toBe('/api/status/login/velo')
    expect(u.searchParams.get('key')).toBe('pr3805')
    expect(u.searchParams.get('to')).toBe('/admin/x')
  })
  it('omits key=main (the route defaults to main)', () => {
    expect(signedOutBackPath('velo', { key: 'main' })).toBe('/api/status/login/velo')
  })
  it('keeps a valid walk', () => {
    expect(parse(signedOutBackPath('velo', { walk: 'abc_-1' })).searchParams.get('walk')).toBe('abc_-1')
  })
  it('drops a bad key', () => {
    expect(signedOutBackPath('velo', { key: 'pr3805x' })).toBe('/api/status/login/velo')
    expect(signedOutBackPath('velo', { key: ['pr1'] })).toBe('/api/status/login/velo')
  })
  it('drops an unsafe to', () => {
    expect(signedOutBackPath('velo', { to: '//evil.com' })).toBe('/api/status/login/velo')
    expect(signedOutBackPath('velo', { to: 'https://evil.com/x' })).toBe('/api/status/login/velo')
  })
  it('drops a bad walk', () => {
    expect(signedOutBackPath('velo', { walk: 'a b' })).toBe('/api/status/login/velo')
  })
  it('passes no other params through', () => {
    const u = parse(signedOutBackPath('velo', { key: 'pr1', to: '/a', walk: 'w', redirect: '/evil', email: 'x' }))
    expect([...u.searchParams.keys()].sort()).toEqual(['key', 'to', 'walk'])
  })
  it('a bad slug falls back to /', () => {
    expect(signedOutBackPath('../x', { key: 'pr1' })).toBe('/')
    expect(signedOutBackPath(undefined, {})).toBe('/')
  })
  it('the result survives the sign-in redirect check', async () => {
    const { safeRedirect } = await import('../shared/safe-path')
    const back = signedOutBackPath('velo', { key: 'pr3805', to: '/admin/test1/bookings', walk: 'abc' })
    expect(safeRedirect(back)).toBe(back)
  })
})

describe('walk in the login redirect (#2681)', async () => {
  const { reviewLoginUrl, sanitizeWalk, withWalk } = await import('../server/utils/review-login')
  const { loginHrefFor } = await import('../app/utils/walk')

  it('keeps the page deep link and the walk together', () => {
    const u = new URL(reviewLoginUrl('https://velo.example.dev', 's', 'velo', 'main', '/en/x', 'abc_-1'))
    expect(u.searchParams.get('redirect')).toBe('/en/x?walk=abc_-1')
  })
  it('puts the walk on / when there is no page', () => {
    expect(withWalk('', 'abc')).toBe('/?walk=abc')
    expect(withWalk('/p?a=1', 'abc')).toBe('/p?a=1&walk=abc')
    expect(withWalk('/p', '')).toBe('/p')
  })
  it('drops a malformed or oversized walk', () => {
    expect(sanitizeWalk('a b')).toBe('')
    expect(sanitizeWalk('A'.repeat(2049))).toBe('')
    expect(sanitizeWalk(['x'])).toBe('')
  })
  it('card login link carries both to and walk', () => {
    const u = new URL(loginHrefFor({ app: 'velo', number: 7, title: 'T', steps: ['one', 'two'], to: '/en/x' }), 'http://h')
    expect(u.searchParams.get('to')).toBe('/en/x')
    expect(u.searchParams.get('walk')).toMatch(/^[A-Za-z0-9_-]+$/)
  })
})
