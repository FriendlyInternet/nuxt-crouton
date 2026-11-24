import { describe, it, expect } from 'vitest'
import {
  extractCollectionName,
  extractItemId,
  extractRouteLabel,
  detectOperation,
  buildApiPathIndex,
  parseTeamCollectionRoute,
  classifyRequest
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

// #3255: generated collections are served at /api/teams/<teamId>/<apiPath>[/<itemId>[/move]]
describe('parseTeamCollectionRoute', () => {
  const index = buildApiPathIndex({
    spikeTasks: { name: 'spikeTasks', apiPath: 'spike-tasks' },
    salesProducts: { apiPath: 'sales-products' }, // no name → the registry key
    notAConfig: true
  })

  it('maps the list, create, get, update and delete routes', () => {
    expect(parseTeamCollectionRoute('GET', '/api/teams/t1/spike-tasks', index)).toEqual({ collection: 'spikeTasks', operation: 'list', itemId: undefined })
    expect(parseTeamCollectionRoute('POST', '/api/teams/t1/spike-tasks', index)).toEqual({ collection: 'spikeTasks', operation: 'create', itemId: undefined })
    expect(parseTeamCollectionRoute('GET', '/api/teams/t1/spike-tasks/abc', index)).toEqual({ collection: 'spikeTasks', operation: 'get', itemId: 'abc' })
    expect(parseTeamCollectionRoute('PATCH', '/api/teams/t1/spike-tasks/abc', index)).toEqual({ collection: 'spikeTasks', operation: 'update', itemId: 'abc' })
    expect(parseTeamCollectionRoute('DELETE', '/api/teams/t1/spike-tasks/abc', index)).toEqual({ collection: 'spikeTasks', operation: 'delete', itemId: 'abc' })
  })

  it('ignores the query string (a filtered list is still a list)', () => {
    expect(parseTeamCollectionRoute('GET', '/api/teams/t1/spike-tasks?ids=a,b', index)).toEqual({ collection: 'spikeTasks', operation: 'list', itemId: undefined })
  })

  it('treats reorder as an update with no item, and <id>/move as an update of that item', () => {
    expect(parseTeamCollectionRoute('PATCH', '/api/teams/t1/spike-tasks/reorder', index)).toEqual({ collection: 'spikeTasks', operation: 'update', itemId: undefined })
    expect(parseTeamCollectionRoute('PATCH', '/api/teams/t1/spike-tasks/abc/move', index)).toEqual({ collection: 'spikeTasks', operation: 'update', itemId: 'abc' })
  })

  it('falls back to the registry key when a config has no name', () => {
    expect(parseTeamCollectionRoute('POST', '/api/teams/t1/sales-products', index)?.collection).toBe('salesProducts')
  })

  it('does not track routes that are not a registered collection', () => {
    expect(parseTeamCollectionRoute('GET', '/api/teams/t1/members', index)).toBeUndefined()
    expect(parseTeamCollectionRoute('GET', '/api/teams/t1/spike-tasks/abc/comments', index)).toBeUndefined()
    expect(parseTeamCollectionRoute('GET', '/api/crouton-bookings/teams/t1/spike-tasks', index)).toBeUndefined()
  })
})

describe('classifyRequest', () => {
  const index = buildApiPathIndex({ spikeTasks: { name: 'spikeTasks', apiPath: 'spike-tasks' } })
  const prefixes = [
    { prefix: '/api/crouton-collection/', routeGroup: 'collection' },
    { prefix: '/api/crouton-bookings/', routeGroup: 'bookings' }
  ]

  it('records a generated team route in the collection group', () => {
    expect(classifyRequest('POST', '/api/teams/t1/spike-tasks', prefixes, index))
      .toEqual({ collection: 'spikeTasks', operation: 'create', itemId: undefined, routeGroup: 'collection' })
  })

  it('keeps the old /api/crouton-collection/ behaviour', () => {
    expect(classifyRequest('DELETE', '/api/crouton-collection/tasks/abc', prefixes, index))
      .toEqual({ collection: 'tasks', operation: 'delete', itemId: 'abc', routeGroup: 'collection' })
  })

  it('keeps package prefixes: label from the path, no item id', () => {
    expect(classifyRequest('GET', '/api/crouton-bookings/teams/0f1e2d3c4b5a/customer-bookings', prefixes, index))
      .toEqual({ collection: 'customer-bookings', operation: 'get', itemId: undefined, routeGroup: 'bookings' })
  })

  it('skips anything else', () => {
    expect(classifyRequest('GET', '/api/teams/t1/members', prefixes, index)).toBeUndefined()
    expect(classifyRequest('GET', '/api/_auth/session', prefixes, index)).toBeUndefined()
  })
})
