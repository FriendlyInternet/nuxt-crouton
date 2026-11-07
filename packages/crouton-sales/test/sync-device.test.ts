import { describe, it, expect } from 'vitest'
import { bareDeviceId, shortDeviceId } from '../app/utils/sync-device'

describe('sync-device', () => {
  it('strips the device: prefix', () => {
    expect(bareDeviceId('device:abc')).toBe('abc')
    expect(bareDeviceId('abc')).toBe('abc')
  })
  it('shortens to 8 chars', () => {
    expect(shortDeviceId('device:0123456789abcdef')).toBe('01234567')
  })
  it('falls back to a dash when empty', () => {
    expect(shortDeviceId(null)).toBe('—')
    expect(shortDeviceId('device:')).toBe('—')
  })
})
