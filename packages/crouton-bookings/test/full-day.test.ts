import { describe, it, expect } from 'vitest'
import { FULL_DAY_ID, withFullDay, isBlockedByFullDay, fullDayConflict } from '../app/utils/full-day'

/**
 * #2261 — a location can offer a built-in full-day option that blocks the
 * other slots on that date, and vice versa. Vélo Solidaire: Matin, Après-midi
 * (+ the full day when the switch is on).
 */
const MATIN = { id: 'matin', label: 'Matin' }
const APRES = { id: 'apres', label: 'Après-midi' }

describe('withFullDay — which slots a location offers', () => {
  it('adds the full day after the named slots when the switch is on', () => {
    expect(withFullDay([MATIN, APRES], true).map(s => s.id)).toEqual(['matin', 'apres', FULL_DAY_ID])
  })

  it('offers only the named slots when the switch is off', () => {
    expect(withFullDay([MATIN, APRES], false).map(s => s.id)).toEqual(['matin', 'apres'])
  })

  it('keeps the existing rule: no named slots → just the full day', () => {
    expect(withFullDay([], false).map(s => s.id)).toEqual([FULL_DAY_ID])
    expect(withFullDay([], true).map(s => s.id)).toEqual([FULL_DAY_ID])
  })
})

describe('isBlockedByFullDay — the booking form', () => {
  it('blocks the full day when a half day is already taken (booked or in cart)', () => {
    expect(isBlockedByFullDay(FULL_DAY_ID, ['apres'], [])).toBe(true)
  })

  it('blocks every half day when the full day is taken', () => {
    expect(isBlockedByFullDay('matin', [FULL_DAY_ID], [])).toBe(true)
    expect(isBlockedByFullDay('apres', [FULL_DAY_ID], [])).toBe(true)
  })

  it('leaves the other half day free when one half day is taken', () => {
    expect(isBlockedByFullDay('matin', ['apres'], [])).toBe(false)
  })

  it('blocks the full day while a half day is ticked in this booking', () => {
    expect(isBlockedByFullDay(FULL_DAY_ID, [], ['matin'])).toBe(true)
  })

  it('blocks the half days while the full day is ticked in this booking', () => {
    expect(isBlockedByFullDay('matin', [], [FULL_DAY_ID])).toBe(true)
  })

  it('never blocks a slot because of itself being ticked', () => {
    expect(isBlockedByFullDay(FULL_DAY_ID, [], [FULL_DAY_ID])).toBe(false)
    expect(isBlockedByFullDay('matin', [], ['matin'])).toBe(false)
  })

  it('leaves everything free on an empty day', () => {
    expect(isBlockedByFullDay(FULL_DAY_ID, [], [])).toBe(false)
    expect(isBlockedByFullDay('matin', [], [])).toBe(false)
  })
})

describe('fullDayConflict — the server check on create', () => {
  it('refuses a full day when the date already has a half day', () => {
    expect(fullDayConflict([FULL_DAY_ID], ['apres'])).toBe(true)
  })

  it('refuses a half day when the date already has the full day', () => {
    expect(fullDayConflict(['matin'], [FULL_DAY_ID])).toBe(true)
  })

  it('refuses one booking that mixes the full day with a half day', () => {
    expect(fullDayConflict([FULL_DAY_ID, 'matin'], [])).toBe(true)
  })

  it('allows the other half day, and a full day on an empty date', () => {
    expect(fullDayConflict(['matin'], ['apres'])).toBe(false)
    expect(fullDayConflict([FULL_DAY_ID], [])).toBe(false)
  })
})
