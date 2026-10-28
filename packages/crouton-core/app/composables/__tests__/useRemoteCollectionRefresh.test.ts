import { describe, it, expect, vi, beforeEach } from 'vitest'
import { effectScope, getCurrentScope, onScopeDispose } from 'vue'

const hooks = new Set<(e: any) => any>()
vi.stubGlobal('getCurrentScope', getCurrentScope)
vi.stubGlobal('onScopeDispose', onScopeDispose)
vi.stubGlobal('useNuxtApp', () => ({
  hook: (name: string, fn: (e: any) => any) => {
    if (name === 'crouton:remoteChange') hooks.add(fn)
    return () => hooks.delete(fn)
  }
}))

import { useRemoteCollectionRefresh } from '../useRemoteCollectionRefresh'

describe('useRemoteCollectionRefresh', () => {
  beforeEach(() => hooks.clear())

  it('refreshes when the event names its collection', async () => {
    const refresh = vi.fn()
    useRemoteCollectionRefresh('products', refresh)
    for (const fn of hooks) await fn({ collection: 'products' })
    expect(refresh).toHaveBeenCalledTimes(1)
  })

  it('ignores other collections', async () => {
    const refresh = vi.fn()
    useRemoteCollectionRefresh('products', refresh)
    for (const fn of hooks) await fn({ collection: 'posts' })
    expect(refresh).not.toHaveBeenCalled()
  })

  it('unsubscribes when its scope is disposed', () => {
    const scope = effectScope()
    scope.run(() => useRemoteCollectionRefresh('products', vi.fn()))
    expect(hooks.size).toBe(1)
    scope.stop()
    expect(hooks.size).toBe(0)
  })
})
