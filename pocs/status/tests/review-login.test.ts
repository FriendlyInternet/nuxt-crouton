import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { reviewLogin, reviewLoginUrl } from '../server/utils/review-login'

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
})

describe('walk redirect', () => {
  it('forwards a valid walk as the post-login redirect', async () => {
    const { sanitizeWalk } = await import('../server/utils/review-login')
    const w = sanitizeWalk('eyJhIjoxfQ')
    expect(w).toBe('eyJhIjoxfQ')
    const u = new URL(reviewLoginUrl('https://velo.pmcp.dev', 's', 'velo', 'main', w))
    expect(u.searchParams.get('redirect')).toBe('/?walk=eyJhIjoxfQ')
    expect(u.searchParams.get('walk')).toBeNull()
  })

  it('drops bad or oversized walk input', async () => {
    const { sanitizeWalk } = await import('../server/utils/review-login')
    expect(sanitizeWalk('not base64!')).toBeNull()
    expect(sanitizeWalk('a'.repeat(2049))).toBeNull()
    expect(sanitizeWalk(undefined)).toBeNull()
    expect(reviewLoginUrl('https://v.dev', 's', 'velo', 'main', null)).not.toContain('redirect')
  })
})
