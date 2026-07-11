/**
 * Drainer start-decision (#1471): auto by default, env var as override.
 */
import { describe, it, expect } from 'vitest'
import { parseDrainerFlag, shouldRunDrainer } from '../server/utils/drainer-gate'

describe('parseDrainerFlag', () => {
  it('reads 1/true as on, 0/false as off, anything else as unset', () => {
    expect(parseDrainerFlag('1')).toBe('on')
    expect(parseDrainerFlag('true')).toBe('on')
    expect(parseDrainerFlag('0')).toBe('off')
    expect(parseDrainerFlag('false')).toBe('off')
    expect(parseDrainerFlag(undefined)).toBe('unset')
    expect(parseDrainerFlag('')).toBe('unset')
    expect(parseDrainerFlag('yes')).toBe('unset')
  })

  it('is case/space insensitive', () => {
    expect(parseDrainerFlag(' TRUE ')).toBe('on')
    expect(parseDrainerFlag('False')).toBe('off')
  })
})

describe('shouldRunDrainer', () => {
  it('auto (unset): follows raw-socket capability — the Pi runs, Workers do not', () => {
    expect(shouldRunDrainer({ envFlag: 'unset', canUseRawSockets: true })).toBe(true)
    expect(shouldRunDrainer({ envFlag: 'unset', canUseRawSockets: false })).toBe(false)
  })

  it('force on: runs even where sockets look unavailable (back-compat with the old required flag)', () => {
    expect(shouldRunDrainer({ envFlag: 'on', canUseRawSockets: true })).toBe(true)
    expect(shouldRunDrainer({ envFlag: 'on', canUseRawSockets: false })).toBe(true)
  })

  it('force off: never runs, even on a socket-capable Node box (the escape hatch)', () => {
    expect(shouldRunDrainer({ envFlag: 'off', canUseRawSockets: true })).toBe(false)
    expect(shouldRunDrainer({ envFlag: 'off', canUseRawSockets: false })).toBe(false)
  })
})
