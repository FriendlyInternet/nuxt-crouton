import { describe, expect, it } from 'vitest'
import { parseLoginRequest, signedOutBackPath } from '../server/utils/login-request-core'

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
