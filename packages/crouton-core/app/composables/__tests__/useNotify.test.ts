import { describe, it, expect } from 'vitest'
import { hasStatusPill, routeNotification } from '../useNotify'

describe('useNotify routing (#2465)', () => {
  it('detects the pill from app config, not the DOM', () => {
    expect(hasStatusPill({ crouton: { status: 'pill' } })).toBe(true)
    expect(hasStatusPill({})).toBe(false)
    expect(hasStatusPill({ crouton: { status: 'toast' } })).toBe(false)
  })

  it('pill app → feed for auto target (all levels share the rule)', () => {
    expect(routeNotification('auto', true)).toBe('statusbar')
    expect(routeNotification(undefined, true)).toBe('statusbar')
  })

  it('no pill → toast', () => {
    expect(routeNotification('auto', false)).toBe('toast')
  })

  it('explicit target wins', () => {
    expect(routeNotification('toast', true)).toBe('toast')
    expect(routeNotification('statusbar', false)).toBe('statusbar')
  })
})
