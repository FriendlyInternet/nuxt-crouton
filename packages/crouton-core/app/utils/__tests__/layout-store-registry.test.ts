/**
 * Layout store registry (#3650) — one registry per Nuxt app; re-registering the
 * same definition (a plugin re-run on the next server request) is silent.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { createLayoutStoreRegistry, registryFor } from '../layout-store-registry'
import type { CroutonLayoutStoreDefinition } from '../../types/layout'

const def = (id: string): CroutonLayoutStoreDefinition => ({ id, setup: () => ({}), feeds: {} })

afterEach(() => vi.restoreAllMocks())

describe('layout store registry', () => {
  it('(a) registering the same definition twice does not warn and keeps one entry', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const r = createLayoutStoreRegistry()
    const d = def('test')
    r.register(d)
    r.register(d)
    expect(warn).not.toHaveBeenCalled()
    expect(r.list()).toHaveLength(1)
  })

  it('(b) a different definition under the same id warns naming the id; the newer one wins', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const r = createLayoutStoreRegistry()
    const first = def('test')
    const second = def('test')
    r.register(first)
    r.register(second)
    expect(warn).toHaveBeenCalledTimes(1)
    expect(String(warn.mock.calls[0]![0])).toContain('"test"')
    expect(r.get('test')).toBe(second)
  })

  it('(c) two Nuxt apps (two requests) have separate registries', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const appA = {}
    const appB = {}
    expect(registryFor(appA)).toBe(registryFor(appA))
    registryFor(appA).register(def('test'))
    expect(registryFor(appB).get('test')).toBeUndefined()
    registryFor(appB).register(def('test'))
    expect(warn).not.toHaveBeenCalled()
    expect(registryFor(appB).list()).toHaveLength(1)
  })
})
