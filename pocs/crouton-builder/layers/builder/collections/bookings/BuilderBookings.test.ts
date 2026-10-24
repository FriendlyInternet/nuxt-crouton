/**
 * @crouton-generated
 * @collection bookings
 * @layer builder
 *
 * Schema-smoke test (#785): asserts the generated Zod schema accepts a valid
 * record and rejects an invalid one. Runtime-free (zod only) — the e2e fixture
 * smoke owns boot + CRUD. Regenerate with --force; suppress with --no-tests.
 */
import { describe, it, expect } from 'vitest'
import { builderBookingSchema } from './app/composables/useBuilderBookings'

describe('builder/bookings schema (generated)', () => {
  it('accepts a valid record', () => {
    const valid = {
      artist: 'sample',
      venue: 'sample',
      date: '2024-01-01T00:00:00.000Z',
      status: 'sample',
    }
    expect(builderBookingSchema.safeParse(valid).success).toBe(true)
  })

  it('rejects an invalid record', () => {
    const invalid = {
      venue: 'sample',
      date: '2024-01-01T00:00:00.000Z',
      status: 'sample',
    }
    expect(builderBookingSchema.safeParse(invalid).success).toBe(false)
  })
})
