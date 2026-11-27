/**
 * #4471 — on composed pages the Locations block and the tab row agree: one location
 * or none. Runs the real useBookingsLayoutFilters with `useState` stubbed by a ref.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { computed, ref } from 'vue'

vi.stubGlobal('useState', (_k: string, init: () => unknown) => ref(init()))
vi.stubGlobal('computed', computed)

const { useBookingsLayoutFilters } = await import('../app/composables/useBookingsLayoutFilters')

const booking = (id: string, location: string) =>
  ({ id, teamId: 't', location, date: '2026-11-02', slot: '[]', status: 'confirmed', createdAt: '2026-11-02' }) as any

describe('useBookingsLayoutFilters (#4471)', () => {
  let f: ReturnType<typeof useBookingsLayoutFilters>
  beforeEach(() => { f = useBookingsLayoutFilters() })

  // covers: T3
  it('picking A then B leaves only B; picking B again clears it', () => {
    f.toggleLocation('a')
    expect(f.filters.value.locations).toEqual(['a'])
    f.toggleLocation('b')
    expect(f.filters.value.locations).toEqual(['b'])
    f.toggleLocation('b')
    expect(f.filters.value.locations).toEqual([])
  })

  // covers: T3
  it('applyFilters with one location keeps only its bookings', () => {
    f.toggleLocation('location-b')
    const kept = f.applyFilters([booking('1', 'location-a'), booking('2', 'location-b')])
    expect(kept.map(b => b.id)).toEqual(['2'])
  })
})
