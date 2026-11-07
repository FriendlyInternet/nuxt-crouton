import { describe, expect, it } from 'vitest'
import { isOwnerEmail, ownerGate, parseLoginRequest, pickLoginTarget, plainRedirectUrl, signedOutBackPath } from '../server/utils/login-request-core'

describe('signedOutBackPath', () => {
  it('keeps valid key and role', () => {
    expect(signedOutBackPath('velo', { key: 'pr12', role: 'admin' })).toBe('/api/status/login/velo?key=pr12&role=admin')
  })
  it('drops invalid key and role', () => {
    expect(signedOutBackPath('velo', { key: 'evil', role: 'nope' })).toBe('/api/status/login/velo')
  })
  it('falls back to / for a bad slug', () => {
    expect(signedOutBackPath('../x', {})).toBe('/')
  })
})

describe('parseLoginRequest', () => {
  it('rejects bad slug, key and role', () => {
    expect(parseLoginRequest('Bad', { role: 'admin' })).toBeNull()
    expect(parseLoginRequest('velo', { key: 'x', role: 'admin' })).toBeNull()
    expect(parseLoginRequest('velo', { role: 'nope' })).toBeNull()
  })
  it('rejects unsafe to', () => {
    expect(parseLoginRequest('velo', { role: 'admin', to: '//evil.com' })).toBeNull()
  })
  it('accepts a valid request with defaults', () => {
    expect(parseLoginRequest('velo', { role: 'admin' })).toEqual({ app: 'velo', key: 'main', role: 'admin', to: '' })
  })
})

describe('isOwnerEmail', () => {
  it('matches case/space-insensitively', () => expect(isOwnerEmail(' A@b.c ', 'a@B.c')).toBe(true))
  it('rejects empty owner or email', () => {
    expect(isOwnerEmail('a@b.c', '')).toBe(false)
    expect(isOwnerEmail('', '')).toBe(false)
    expect(isOwnerEmail('x@b.c', 'a@b.c')).toBe(false)
  })
})

describe('plainRedirectUrl', () => {
  const w = (to: string, walk: string) => `${to}?w=${walk}`
  it('returns base when no to/walk', () => expect(plainRedirectUrl('https://x.io/', '', '', w)).toBe('https://x.io/'))
  it('trims trailing slash and appends', () => expect(plainRedirectUrl('https://x.io/', '/p', 'a', w)).toBe('https://x.io/p?w=a'))
})

describe('pickLoginTarget', () => {
  it('prefers live over fallback', () => expect(pickLoginTarget({ stagingUrl: 'u', hasSignIn: true }, { stagingUrl: 'f', hasSignIn: false })).toEqual({ stagingUrl: 'u', hasSignIn: true }))
  it('falls back and defaults stagingUrl', () => expect(pickLoginTarget(undefined, { hasSignIn: false })).toEqual({ stagingUrl: '', hasSignIn: false }))
  it('null when unknown', () => expect(pickLoginTarget(undefined, null)).toBeNull())
})

describe('ownerGate', () => {
  it('signed out -> signin with return path', () => {
    const g = ownerGate('', 'o@x.io', 'velo', { key: 'pr12' })
    expect(g).toEqual({ kind: 'signin', location: `/signin?redirect=${encodeURIComponent('/api/status/login/velo?key=pr12')}` })
  })
  it('non-owner -> deny', () => expect(ownerGate('a@x.io', 'o@x.io', 'velo', {})).toEqual({ kind: 'deny' }))
  it('owner -> ok', () => expect(ownerGate('O@x.io', 'o@x.io', 'velo', {})).toEqual({ kind: 'ok' }))
})
