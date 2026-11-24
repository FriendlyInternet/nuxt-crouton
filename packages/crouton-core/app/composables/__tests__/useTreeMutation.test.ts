import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { ref, computed } from 'vue'

// Mock dependencies
const mockToastAdd = vi.fn()
const mockMarkSaving = vi.fn()
const mockMarkSaved = vi.fn()
const mockMarkError = vi.fn()
const mockTriggerCountFlash = vi.fn()
const mockCallHook = vi.fn()
const mockRefreshNuxtData = vi.fn()
const mockFetch = vi.fn()

// Set up global mocks
vi.stubGlobal('ref', ref)
vi.stubGlobal('computed', computed)
vi.stubGlobal('readonly', (val: any) => val)

vi.stubGlobal('useRoute', () => ({
  path: '/teams/team-a/pages',
  params: { team: 'team-a' }
}))

// Current team (team-a); a save here must never refresh team-b's slots
vi.stubGlobal('useTeam', () => ({ currentTeam: ref({ id: 'team-a' }) }))

vi.stubGlobal('useToast', () => ({
  add: mockToastAdd
}))

// Mock useT — translation keys used by useTreeMutation
const treeMutationTranslations: Record<string, string> = {
  'mutations.moveFailed': 'Move failed',
  'mutations.reorderFailed': 'Reorder failed',
}
vi.stubGlobal('useT', () => ({ t: (key: string) => treeMutationTranslations[key] || key }))

// Mock useNotify — delegates to mockToastAdd
vi.stubGlobal('useNotify', () => ({
  success: (title: string, options?: any) => mockToastAdd({ title, description: options?.description, color: 'success' }),
  info: (title: string, options?: any) => mockToastAdd({ title, description: options?.description, color: 'primary' }),
  warning: (title: string, options?: any) => mockToastAdd({ title, description: options?.description, color: 'warning' }),
  error: (title: string, options?: any) => mockToastAdd({ title, description: options?.description, color: 'error' }),
}))

let mockCollectionConfig = {
  apiPath: 'pages',
  sortable: { enabled: false },
  hierarchy: { enabled: true }
}

vi.stubGlobal('useCollections', () => ({
  getConfig: (name: string) => name === 'pages' ? mockCollectionConfig : null
}))

vi.stubGlobal('useTeamContext', () => ({
  getTeamId: () => 'team-123'
}))

vi.stubGlobal('useTreeItemState', () => ({
  markSaving: mockMarkSaving,
  markSaved: mockMarkSaved,
  markError: mockMarkError,
  triggerCountFlash: mockTriggerCountFlash
}))

let mockPayloadData: Record<string, any> = {}
vi.stubGlobal('useNuxtApp', () => ({
  payload: { data: mockPayloadData },
  hooks: { callHook: mockCallHook }
}))

vi.stubGlobal('refreshNuxtData', mockRefreshNuxtData)
vi.stubGlobal('$fetch', mockFetch)
vi.stubGlobal('generateCorrelationId', () => 'crtn_test_12345678')

// Mock console
vi.stubGlobal('console', {
  ...console,
  log: vi.fn(),
  error: vi.fn(),
  group: vi.fn(),
  groupEnd: vi.fn()
})

// Import after mocking — the real key builder (#4506), resolving to this file's stubs
import { useCollectionCacheKeys } from '../useCollectionCacheKeys'
import { useTreeMutation } from '../useTreeMutation'

vi.stubGlobal('useCollectionCacheKeys', useCollectionCacheKeys)

describe('useTreeMutation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockFetch.mockResolvedValue(undefined)
    mockRefreshNuxtData.mockResolvedValue(undefined)
    mockCallHook.mockResolvedValue(undefined)
    mockPayloadData = {}
    mockCollectionConfig = {
      apiPath: 'pages',
      sortable: { enabled: false },
      hierarchy: { enabled: true }
    }
  })

  describe('initialization', () => {
    it('returns moveNode, reorderSiblings, moving, and reordering', () => {
      const mutation = useTreeMutation('pages')

      expect(mutation.moveNode).toBeDefined()
      expect(typeof mutation.moveNode).toBe('function')
      expect(mutation.reorderSiblings).toBeDefined()
      expect(typeof mutation.reorderSiblings).toBe('function')
      expect(mutation.moving).toBeDefined()
      expect(mutation.reordering).toBeDefined()
    })

    it('throws error for unregistered collection', () => {
      expect(() => useTreeMutation('unknown')).toThrow('Collection "unknown" not registered')
    })
  })

  describe('moveNode() - hierarchy mode', () => {
    it('calls PATCH to move endpoint', async () => {
      const { moveNode } = useTreeMutation('pages')

      await moveNode('page-1', 'parent-1', 2)

      expect(mockFetch).toHaveBeenCalledWith(
        '/api/teams/team-123/pages/page-1/move',
        expect.objectContaining({
          method: 'PATCH',
          body: { parentId: 'parent-1', order: 2 },
          credentials: 'include'
        })
      )
    })

    it('handles null parentId for root level', async () => {
      const { moveNode } = useTreeMutation('pages')

      await moveNode('page-1', null, 0)

      expect(mockFetch).toHaveBeenCalledWith(
        '/api/teams/team-123/pages/page-1/move',
        expect.objectContaining({
          body: { parentId: null, order: 0 }
        })
      )
    })

    it('marks item as saving during mutation', async () => {
      const { moveNode } = useTreeMutation('pages')

      await moveNode('page-1', 'parent-1', 0)

      expect(mockMarkSaving).toHaveBeenCalledWith('page-1')
    })

    it('marks item as saved on success', async () => {
      const { moveNode } = useTreeMutation('pages')

      await moveNode('page-1', 'parent-1', 0)

      expect(mockMarkSaved).toHaveBeenCalledWith('page-1')
    })

    it('triggers count flash on parent', async () => {
      const { moveNode } = useTreeMutation('pages')

      await moveNode('page-1', 'parent-1', 0)

      expect(mockTriggerCountFlash).toHaveBeenCalledWith('parent-1')
    })

    it('does not flash count for root level moves', async () => {
      const { moveNode } = useTreeMutation('pages')

      await moveNode('page-1', null, 0)

      expect(mockTriggerCountFlash).not.toHaveBeenCalled()
    })

    it('emits crouton:mutation hook', async () => {
      const { moveNode } = useTreeMutation('pages')

      await moveNode('page-1', 'parent-1', 2)

      expect(mockCallHook).toHaveBeenCalledWith('crouton:mutation', expect.objectContaining({
        operation: 'move',
        collection: 'pages',
        itemId: 'page-1',
        data: { parentId: 'parent-1', order: 2 }
      }))
    })

    it('invalidates cache after success', async () => {
      const { moveNode } = useTreeMutation('pages')

      await moveNode('page-1', 'parent-1', 0)

      expect(mockRefreshNuxtData).toHaveBeenCalledWith('collection:pages:team-a:{}')
    })

    it('marks error on failure', async () => {
      mockFetch.mockRejectedValue(new Error('Move failed'))
      const { moveNode } = useTreeMutation('pages')

      await expect(moveNode('page-1', 'parent-1', 0)).rejects.toThrow('Move failed')
      expect(mockMarkError).toHaveBeenCalledWith('page-1')
    })

    it('shows toast on failure', async () => {
      mockFetch.mockRejectedValue({ data: { message: 'Invalid move' } })
      const { moveNode } = useTreeMutation('pages')

      await expect(moveNode('page-1', 'parent-1', 0)).rejects.toBeDefined()
      expect(mockToastAdd).toHaveBeenCalledWith(expect.objectContaining({
        title: 'Move failed',
        color: 'error'
      }))
    })
  })

  describe('moveNode() - sortable-only mode', () => {
    beforeEach(() => {
      mockCollectionConfig = {
        apiPath: 'pages',
        sortable: { enabled: true },
        hierarchy: { enabled: false }
      }
    })

    it('fetches current items to calculate order', async () => {
      mockFetch.mockResolvedValueOnce([
        { id: 'a', order: 0 },
        { id: 'b', order: 1 },
        { id: 'c', order: 2 }
      ])

      const { moveNode } = useTreeMutation('pages')

      await moveNode('c', null, 0) // Move 'c' to first position

      // Should fetch current items
      expect(mockFetch).toHaveBeenCalledWith(
        '/api/teams/team-123/pages',
        expect.objectContaining({ credentials: 'include' })
      )

      // Should call reorder endpoint
      expect(mockFetch).toHaveBeenCalledWith(
        '/api/teams/team-123/pages/reorder',
        expect.objectContaining({
          method: 'PATCH',
          body: {
            updates: [
              { id: 'c', order: 0 },
              { id: 'a', order: 1 },
              { id: 'b', order: 2 }
            ]
          }
        })
      )
    })

    it('ignores parentId in sortable-only mode', async () => {
      mockFetch.mockResolvedValueOnce([
        { id: 'a', order: 0 },
        { id: 'b', order: 1 }
      ])

      const { moveNode } = useTreeMutation('pages')

      await moveNode('b', 'some-parent', 0) // parentId should be ignored

      // Should use reorder endpoint, not move
      expect(mockFetch).toHaveBeenLastCalledWith(
        '/api/teams/team-123/pages/reorder',
        expect.any(Object)
      )
    })
  })

  describe('reorderSiblings()', () => {
    it('calls PATCH to reorder endpoint', async () => {
      const { reorderSiblings } = useTreeMutation('pages')
      const updates = [
        { id: 'page-1', order: 0 },
        { id: 'page-2', order: 1 },
        { id: 'page-3', order: 2 }
      ]

      await reorderSiblings(updates)

      expect(mockFetch).toHaveBeenCalledWith(
        '/api/teams/team-123/pages/reorder',
        expect.objectContaining({
          method: 'PATCH',
          body: { updates },
          credentials: 'include'
        })
      )
    })

    it('emits crouton:mutation hook with reorder operation', async () => {
      const { reorderSiblings } = useTreeMutation('pages')
      const updates = [{ id: 'page-1', order: 0 }]

      await reorderSiblings(updates)

      expect(mockCallHook).toHaveBeenCalledWith('crouton:mutation', expect.objectContaining({
        operation: 'reorder',
        collection: 'pages',
        data: { updates }
      }))
    })

    it('invalidates cache after success', async () => {
      const { reorderSiblings } = useTreeMutation('pages')

      await reorderSiblings([{ id: 'page-1', order: 0 }])

      expect(mockRefreshNuxtData).toHaveBeenCalledWith('collection:pages:team-a:{}')
    })

    it('marks all items as saved', async () => {
      const { reorderSiblings } = useTreeMutation('pages')
      const updates = [
        { id: 'page-1', order: 0 },
        { id: 'page-2', order: 1 }
      ]

      await reorderSiblings(updates)

      expect(mockMarkSaved).toHaveBeenCalledWith('page-1')
      expect(mockMarkSaved).toHaveBeenCalledWith('page-2')
    })

    it('shows toast on failure', async () => {
      mockFetch.mockRejectedValue({ data: 'Reorder failed' })
      const { reorderSiblings } = useTreeMutation('pages')

      await expect(reorderSiblings([{ id: 'page-1', order: 0 }])).rejects.toBeDefined()
      expect(mockToastAdd).toHaveBeenCalledWith(expect.objectContaining({
        title: 'Reorder failed',
        color: 'error'
      }))
    })
  })

  describe('super-admin routes', () => {
    beforeEach(() => {
      vi.stubGlobal('useRoute', () => ({
        path: '/super-admin/pages'
      }))
    })

    afterEach(() => {
      vi.stubGlobal('useRoute', () => ({
        path: '/teams/test-team/pages'
      }))
    })

    it('uses super-admin path for moveNode', async () => {
      const { moveNode } = useTreeMutation('pages')

      await moveNode('page-1', null, 0)

      expect(mockFetch).toHaveBeenCalledWith(
        '/api/super-admin/pages/page-1/move',
        expect.any(Object)
      )
    })

    it('uses super-admin path for reorderSiblings', async () => {
      const { reorderSiblings } = useTreeMutation('pages')

      await reorderSiblings([{ id: 'page-1', order: 0 }])

      expect(mockFetch).toHaveBeenCalledWith(
        '/api/super-admin/pages/reorder',
        expect.any(Object)
      )
    })
  })

  describe('team context error handling', () => {
    beforeEach(() => {
      vi.stubGlobal('useTeamContext', () => ({
        getTeamId: () => undefined
      }))
      vi.stubGlobal('useRoute', () => ({
        path: '/teams/unknown/pages' // Not super-admin, needs team
      }))
    })

    afterEach(() => {
      vi.stubGlobal('useTeamContext', () => ({
        getTeamId: () => 'team-123'
      }))
      vi.stubGlobal('useRoute', () => ({
        path: '/teams/test-team/pages'
      }))
    })

    it('throws when team context is required but missing', async () => {
      const { moveNode } = useTreeMutation('pages')

      await expect(moveNode('page-1', null, 0)).rejects.toThrow('Team context required')
    })
  })

  describe('loading states', () => {
    it('moving is true during moveNode', async () => {
      let resolvePromise: () => void
      mockFetch.mockReturnValue(new Promise<void>(resolve => { resolvePromise = resolve }))

      const { moveNode, moving } = useTreeMutation('pages')

      expect(moving.value).toBe(false)

      const promise = moveNode('page-1', null, 0)

      // Note: Due to how the mock works, we need to wait for the promise to be created
      await Promise.resolve()
      expect(moving.value).toBe(true)

      resolvePromise!()
      await promise

      expect(moving.value).toBe(false)
    })

    it('reordering is true during reorderSiblings', async () => {
      let resolvePromise: () => void
      mockFetch.mockReturnValue(new Promise<void>(resolve => { resolvePromise = resolve }))

      const { reorderSiblings, reordering } = useTreeMutation('pages')

      expect(reordering.value).toBe(false)

      const promise = reorderSiblings([{ id: 'page-1', order: 0 }])

      await Promise.resolve()
      expect(reordering.value).toBe(true)

      resolvePromise!()
      await promise

      expect(reordering.value).toBe(false)
    })
  })

  describe('custom apiPath', () => {
    beforeEach(() => {
      mockCollectionConfig = {
        apiPath: 'custom-pages-path',
        sortable: { enabled: false },
        hierarchy: { enabled: true }
      }
    })

    it('uses custom apiPath in URL', async () => {
      const { moveNode } = useTreeMutation('pages')

      await moveNode('page-1', null, 0)

      expect(mockFetch).toHaveBeenCalledWith(
        '/api/teams/team-123/custom-pages-path/page-1/move',
        expect.any(Object)
      )
    })
  })
  // covers: T6
  describe('refreshes only the current team (#4506)', () => {
    const twoTeamPayload = () => ({
      'collection:pages:team-a:{}': [],
      'collection:pages:team-a:{"eventId":"e1"}': [],
      'collection:pages:team-b:{}': [],
      'collection:pagesArchive:team-a:{}': [],
      'collection-item:pages:team-a:p1': {},
      'collection-item:pages:team-b:p1': {}
    })

    it('moveNode refreshes exactly the team-a list keys', async () => {
      mockPayloadData = twoTeamPayload()
      const { moveNode } = useTreeMutation('pages')

      await moveNode('p1', null, 0)

      const calls = mockRefreshNuxtData.mock.calls.map(c => c[0]).sort()
      expect(calls).toEqual([
        'collection:pages:team-a:{"eventId":"e1"}',
        'collection:pages:team-a:{}'
      ].sort())
    })

    it('reorderSiblings refreshes exactly the team-a list keys', async () => {
      mockPayloadData = twoTeamPayload()
      const { reorderSiblings } = useTreeMutation('pages')

      await reorderSiblings([{ id: 'p1', order: 0 }])

      const calls = mockRefreshNuxtData.mock.calls.map(c => c[0]).sort()
      expect(calls).toEqual([
        'collection:pages:team-a:{"eventId":"e1"}',
        'collection:pages:team-a:{}'
      ].sort())
    })
  })
})
