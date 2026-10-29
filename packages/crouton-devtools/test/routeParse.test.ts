import { describe, it, expect } from 'vitest'
import {
  extractCollectionName,
  extractItemId,
  extractRouteLabel,
  detectOperation
} from '../src/runtime/server/utils/routeParse'

describe('extractCollectionName', () => {
  it('reads the collection segment, ignoring the query', () => {
    expect(extractCollectionName('/api/crouton-collection/tasks/search?q=x')).toBe('tasks')
  })
  it('falls back to unknown', () => {
    expect(extractCollectionName('/api/other')).toBe('unknown')
  })
})

describe('extractItemId', () => {
  it('returns the id segment', () => {
    expect(extractItemId('/api/crouton-collection/tasks/abc-123')).toBe('abc-123')
  })
  it('ignores search, export and the bare collection', () => {
    expect(extractItemId('/api/crouton-collection/tasks/search')).toBeUndefined()
    expect(extractItemId('/api/crouton-collection/tasks/export')).toBeUndefined()
    expect(extractItemId('/api/crouton-collection/tasks')).toBeUndefined()
  })
})

describe('extractRouteLabel', () => {
  it('skips teams and hex ids', () => {
    expect(
      extractRouteLabel('/api/crouton-bookings/teams/0f1e2d3c4b5a/customer-bookings', '/api/crouton-bookings')
    ).toBe('customer-bookings')
  })
})

describe('detectOperation', () => {
  it('maps method and path to an operation', () => {
    expect(detectOperation('GET', '/api/crouton-collection/tasks/search')).toBe('list')
    expect(detectOperation('POST', '/api/crouton-collection/tasks')).toBe('create')
    expect(detectOperation('DELETE', '/api/crouton-collection/tasks/1')).toBe('delete')
  })
})
