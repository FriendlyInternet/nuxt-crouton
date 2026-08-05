import { describe, it, expect } from 'vitest'
import { resolveDialect } from '../../lib/generate-collection.ts'

// #1450 — an explicit `dialect: null`/`''` survives c12's defu (the `defaults.dialect`
// only fills an *absent* key) and used to hit `config.dialect || 'pg'`, silently
// routing D1-only apps into the unexercised PostgreSQL path. The fallback is now
// sqlite everywhere; these lock that in. The dialect→artifact mapping itself is
// covered by generators/database-schema.test.ts.
describe('resolveDialect', () => {
  it('falls back to sqlite when dialect is explicitly null (the discriminating case)', () => {
    // `null` is the value that survives defu and previously produced `'pg'`
    expect(resolveDialect({ dialect: null })).toBe('sqlite')
  })

  it('falls back to sqlite when dialect is an empty string', () => {
    expect(resolveDialect({ dialect: '' })).toBe('sqlite')
  })

  it('falls back to sqlite when the dialect key is absent (regression guard)', () => {
    // an absent key is also filled by c12's defaults.dialect, but resolveDialect
    // must agree even if that default is ever removed
    expect(resolveDialect({})).toBe('sqlite')
    expect(resolveDialect({ dialect: undefined })).toBe('sqlite')
  })

  it('falls back to sqlite when config itself is null/undefined', () => {
    expect(resolveDialect(null)).toBe('sqlite')
    expect(resolveDialect(undefined)).toBe('sqlite')
  })

  it('preserves an explicitly chosen dialect', () => {
    expect(resolveDialect({ dialect: 'sqlite' })).toBe('sqlite')
    expect(resolveDialect({ dialect: 'pg' })).toBe('pg')
  })
})
