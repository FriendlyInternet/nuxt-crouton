/**
 * Which block a scoped page's gate takes its event from (#4480).
 *
 * A kitchen-only page used to get no event gate at all, because only
 * `eventWorkspaceBlock` was looked at — so its screen could never get a helper
 * token. `scopedEventSlug` also accepts `kitchenDisplayBlock`.
 */
import { describe, it, expect } from 'vitest'
import { scopedEventSlug } from '../server/utils/scoped-event-block'

const kitchen = (eventSlug?: unknown) => ({ type: 'kitchenDisplayBlock', attrs: { eventSlug } })
const workspace = (eventSlug?: unknown) => ({ type: 'eventWorkspaceBlock', attrs: { eventSlug } })

describe('scopedEventSlug', () => {
  // covers: T2
  it('kitchen-only page → its slug', () => {
    expect(scopedEventSlug([kitchen('summer-fest')])).toBe('summer-fest')
  })

  // covers: T2
  it('workspace-only page → its slug', () => {
    expect(scopedEventSlug([workspace('summer-fest')])).toBe('summer-fest')
  })

  // covers: T2
  it('both with slugs → the first one\'s', () => {
    expect(scopedEventSlug([kitchen('a'), workspace('b')])).toBe('a')
    expect(scopedEventSlug([workspace('b'), kitchen('a')])).toBe('b')
  })

  // covers: T2
  it('slug-less kitchen first, then workspace → the workspace slug', () => {
    expect(scopedEventSlug([kitchen(''), workspace('b')])).toBe('b')
  })

  // covers: T2
  it('neither block → undefined', () => {
    expect(scopedEventSlug([{ type: 'paragraph' }, { type: 'heroBlock', attrs: { eventSlug: 'x' } }])).toBeUndefined()
    expect(scopedEventSlug([])).toBeUndefined()
  })

  // covers: T2
  it('only a slug-less or whitespace-only kitchen block → undefined', () => {
    expect(scopedEventSlug([kitchen()])).toBeUndefined()
    expect(scopedEventSlug([kitchen('   ')])).toBeUndefined()
    expect(scopedEventSlug([kitchen(42)])).toBeUndefined()
  })

  // covers: T2
  it('trims the slug', () => {
    expect(scopedEventSlug([kitchen('  summer-fest  ')])).toBe('summer-fest')
  })
})
