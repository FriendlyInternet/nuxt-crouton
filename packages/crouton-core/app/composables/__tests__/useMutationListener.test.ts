import { describe, it, expect, vi, beforeEach } from 'vitest'
import { effectScope, getCurrentScope, onScopeDispose } from 'vue'

const hooks = new Set<(e: any) => any>()
vi.stubGlobal('getCurrentScope', getCurrentScope)
vi.stubGlobal('onScopeDispose', onScopeDispose)
vi.stubGlobal('useNuxtApp', () => ({
  hook: (name: string, fn: (e: any) => any) => {
    if (name === 'crouton:mutation') hooks.add(fn)
    return () => hooks.delete(fn)
  }
}))

import { useMutationListener } from '../useMutationListener'

describe('useMutationListener', () => {
  beforeEach(() => hooks.clear())

  it('passes the mutation event to the handler', async () => {
    const handler = vi.fn()
    useMutationListener(handler)
    const event = { operation: 'update', collection: 'pagesPages', itemId: 'p1' }
    for (const fn of hooks) await fn(event)
    expect(handler).toHaveBeenCalledTimes(1)
    expect(handler).toHaveBeenCalledWith(event)
  })

  it('removes its listener when its scope stops', () => {
    const scope = effectScope()
    scope.run(() => useMutationListener(vi.fn()))
    expect(hooks.size).toBe(1)
    scope.stop()
    expect(hooks.size).toBe(0)
  })
})
