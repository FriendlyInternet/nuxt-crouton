import { describe, it, expect } from 'vitest'
import { initFormState } from '../init-form-state'

// #1498 — a nullable DB column round-trips `null`; on the edit path the loaded
// record spreads over the form defaults, so that `null` overrides the default
// and reaches the deliberately-narrow client schema (`.optional()`, kept narrow
// by #1403), which rejects it and silently blocks submit. initFormState coerces
// a `null` back to the form default so state never carries it — no schema or
// type widening.
describe('initFormState', () => {
  it('returns a fresh copy of the defaults when there is no active item (create)', () => {
    const defaults = { title: '', options: [], isActive: false }
    const state = initFormState(defaults, null)
    expect(state).toEqual(defaults)
    expect(state).not.toBe(defaults)
    state.title = 'x'
    expect(defaults.title).toBe('') // not mutated
  })

  it('coerces a nullable field\'s null back to its form default', () => {
    const state = initFormState(
      { title: '', description: '', options: [], requiresRemark: false },
      { id: 'p1', title: 'Frisdrank', description: null, options: null, requiresRemark: null }
    )
    expect(state).toEqual({
      id: 'p1',
      title: 'Frisdrank',
      description: '',
      options: [],
      requiresRemark: false
    })
  })

  it('keeps real (non-null) values from the active item', () => {
    const state = initFormState(
      { title: '', price: 0, isActive: false },
      { title: 'Cola', price: 2.5, isActive: true }
    )
    expect(state).toEqual({ title: 'Cola', price: 2.5, isActive: true })
  })

  it('passes system fields through untouched (they are not in defaultValue)', () => {
    const state = initFormState(
      { title: '' },
      { id: 'p1', teamId: 't1', createdAt: '2026-01-01', title: 'X', ownerId: null }
    )
    // ownerId is not a form field → not coerced; system fields survive
    expect(state).toMatchObject({ id: 'p1', teamId: 't1', createdAt: '2026-01-01', title: 'X', ownerId: null })
  })

  it('leaves undefined active values to fall back to the default', () => {
    const state = initFormState({ title: 'def' }, { title: undefined })
    expect(state.title).toBe('def')
  })
})
