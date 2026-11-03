/**
 * #2311 — a reference cell in the list must point at the TARGET's collection key.
 * Same bug as the form picker: the key was built from the current layer (`mainAssets`).
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { generateListComponent } from '../../../lib/generators/list-component.ts'
import { formComponentData, minimalConfig, withComponent } from '../../fixtures/sample-data.mjs'

beforeAll(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2025-01-01'))
})
afterAll(() => {
  vi.useRealTimers()
})

const refData = {
  ...formComponentData,
  layer: 'main',
  layerPascalCase: 'Main',
  layerCamelCase: 'main',
  collectionLayerMap: new Map([['assets', 'crouton']]),
  fields: withComponent([
    { name: 'name', type: 'string', meta: { required: true } },
    { name: 'imageId', type: 'string', refTarget: 'assets', meta: {} },
  ]),
}

describe('generateListComponent — reference to another layer', () => {
  it('resolves the cell collection key through the target layer', () => {
    const result = generateListComponent(refData, minimalConfig as any)
    expect(result).toContain('collection="croutonAssets"')
    expect(result).not.toContain('collection="mainAssets"')
  })
})
