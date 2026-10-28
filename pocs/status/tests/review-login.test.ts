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
