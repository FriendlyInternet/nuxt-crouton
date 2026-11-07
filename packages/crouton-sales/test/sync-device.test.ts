import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { bareDeviceId, shortDeviceId } from '../app/utils/sync-device'

describe('sync-device', () => {
  it('strips the device: prefix only at the start', () => {
    expect(bareDeviceId('device:abc')).toBe('abc')
    expect(bareDeviceId('abc')).toBe('abc')
    expect(bareDeviceId('x-device:1')).toBe('x-device:1')
  })
  it('shortens to 8 chars, with or without prefix', () => {
    expect(shortDeviceId('device:0123456789abcdef')).toBe('01234567')
    expect(shortDeviceId('0123456789abcdef')).toBe('01234567')
  })
  it('falls back to a dash when empty', () => {
    expect(shortDeviceId(null)).toBe('—')
    expect(shortDeviceId(undefined)).toBe('—')
    expect(shortDeviceId('')).toBe('—')
    expect(shortDeviceId('device:')).toBe('—')
  })
})

describe('Sync screens use the shared helper', () => {
  const dir = join(__dirname, '../app/components/Sync')
  const files = readdirSync(dir).filter(f => f.endsWith('.vue'))
  it.each(files)('%s keeps no private copy of the id shortening', (f) => {
    const src = readFileSync(join(dir, f), 'utf8')
    expect(src).not.toMatch(/slice\(0,\s*8\)/)
    expect(src).not.toMatch(/replace\(\/\^device:/)
  })
})
