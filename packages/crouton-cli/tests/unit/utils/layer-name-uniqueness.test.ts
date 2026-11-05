import { describe, it, expect, beforeEach } from 'vitest'
import { resolve } from 'pathe'
import {
  assertUniqueLayerNames,
  clearManifestCache,
  discoverManifests,
  type CroutonManifest,
} from '../../../lib/utils/manifest-loader'

const m = (id: string, layer?: string) =>
  ({ id, layer: layer ? { name: layer, editable: false } : undefined }) as unknown as CroutonManifest

describe('assertUniqueLayerNames', () => {
  it('passes for distinct layer names and manifests without a layer', () => {
    expect(() => assertUniqueLayerNames([m('a', 'x'), m('b', 'y'), m('c')])).not.toThrow()
  })

  it('throws naming both packages and the layer on a duplicate', () => {
    expect(() => assertUniqueLayerNames([m('crouton-a', 'dup'), m('crouton-b', 'dup')]))
      .toThrow(/"dup".*"crouton-a".*"crouton-b"/)
  })
})

describe('real packages corpus', () => {
  beforeEach(() => clearManifestCache())

  it('has no duplicate layer names across packages/*', async () => {
    const manifests = await discoverManifests(resolve(__dirname, '../../../../..'))
    expect(manifests.length).toBeGreaterThan(5)
    expect(() => assertUniqueLayerNames(manifests)).not.toThrow()
  })
})
