import { describe, it, expect } from 'vitest'
import { errorText } from '../error-text'

describe('errorText', () => {
  it('reads Nitro v3 statusText', () => {
    expect(errorText({ status: 400, statusText: 'Title is required' }, 'x')).toBe('Title is required')
    expect(errorText({ data: { status: 400, statusText: 'Bad' } }, 'x')).toBe('Bad')
  })
  it('reads legacy data.message', () => {
    expect(errorText({ data: { message: 'Nope' } }, 'x')).toBe('Nope')
  })
  it('accepts a plain string', () => {
    expect(errorText('boom', 'x')).toBe('boom')
    expect(errorText({ data: 'raw' }, 'x')).toBe('raw')
  })
  it('falls back for objects without a usable text', () => {
    expect(errorText({ data: { foo: 1 } }, 'fallback')).toBe('fallback')
    expect(errorText(undefined, 'fallback')).toBe('fallback')
  })
})
