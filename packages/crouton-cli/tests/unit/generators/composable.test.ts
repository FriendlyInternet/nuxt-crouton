import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { generateComposable } from '../../../lib/generators/composable.ts'

// Mock date to prevent snapshot failures due to @generated timestamp
beforeAll(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2025-01-01'))
})

afterAll(() => {
  vi.useRealTimers()
})
import {
  basicComposableData,
  hierarchyData,
  sortableData,
  dependentFieldsData,
  displayConfigData,
  minimalConfig
} from '../../fixtures/sample-data.mjs'

describe('generateComposable', () => {
  it('generates correct composable for basic collection', () => {
    const result = generateComposable(basicComposableData, minimalConfig)
    expect(result).toMatchSnapshot()
  })

  it('includes AI context header', () => {
    const result = generateComposable(basicComposableData, minimalConfig)
    expect(result).toContain('@crouton-generated')
    expect(result).toContain('@collection products')
    expect(result).toContain('@layer shop')
    expect(result).toContain('API endpoint: /api/teams/[id]/shop-products')
  })

  it('generates correct composable name with layer prefix', () => {
    const result = generateComposable(basicComposableData, minimalConfig)
    expect(result).toContain('export const useShopProducts')
    expect(result).toContain('export const shopProductSchema')
    expect(result).toContain('export const shopProductsColumns')
    expect(result).toContain('export const shopProductsConfig')
  })

  it('generates Zod schema', () => {
    const result = generateComposable(basicComposableData, minimalConfig)
    expect(result).toContain("import { z } from 'zod'")
    expect(result).toContain('z.object({')
  })

  it('generates columns array', () => {
    const result = generateComposable(basicComposableData, minimalConfig)
    expect(result).toContain('shopProductsColumns = [')
  })

  it('generates config object with correct properties', () => {
    const result = generateComposable(basicComposableData, minimalConfig)
    expect(result).toContain("name: 'shopProducts'")
    expect(result).toContain("layer: 'shop'")
    expect(result).toContain("apiPath: 'shop-products'")
    expect(result).not.toContain('componentName')
    expect(result).toContain('defaultValues: {')
  })

  it('always emits the canonical form name — collectionConfig cannot override it', () => {
    const result = generateComposable(
      { ...basicComposableData, collectionConfig: { formComponent: 'CustomForm' } },
      minimalConfig
    )
    expect(result).not.toContain('componentName')
    expect(result).not.toContain('CustomForm')
  })

  it('generates non-enumerable schema property', () => {
    const result = generateComposable(basicComposableData, minimalConfig)
    expect(result).toContain('Object.defineProperty(_shopProductsConfig')
    expect(result).toContain('enumerable: false')
  })

  it('generates default export function', () => {
    const result = generateComposable(basicComposableData, minimalConfig)
    expect(result).toContain('export default function ()')
    expect(result).toContain('defaultValue: shopProductsConfig.defaultValues')
    expect(result).toContain('schema: shopProductSchema')
  })

  describe('hierarchy support', () => {
    it('includes hierarchy config when enabled', () => {
      const result = generateComposable(hierarchyData, minimalConfig)
      expect(result).toContain('hierarchy: {')
      expect(result).toContain('enabled: true')
      expect(result).toContain("parentField: 'parentId'")
      expect(result).toContain("pathField: 'path'")
      expect(result).toContain("depthField: 'depth'")
      expect(result).toContain("orderField: 'order'")
    })

    it('excludes hierarchy config when not enabled', () => {
      const result = generateComposable(basicComposableData, minimalConfig)
      expect(result).not.toContain('hierarchy: {')
    })
  })

  describe('sortable support', () => {
    it('includes sortable config when enabled', () => {
      const result = generateComposable(sortableData, minimalConfig)
      expect(result).toContain('sortable: {')
      expect(result).toContain('enabled: true')
      expect(result).toContain("orderField: 'order'")
    })

    it('excludes sortable config when hierarchy is enabled', () => {
      // Hierarchy takes precedence over sortable
      const dataWithBoth = {
        ...sortableData,
        hierarchy: hierarchyData.hierarchy
      }
      const result = generateComposable(dataWithBoth, minimalConfig)
      expect(result).toContain('hierarchy: {')
      expect(result).not.toContain('sortable: {')
    })
  })

  describe('dependent fields', () => {
    it('generates dependentFieldComponents for repeater fields', () => {
      const result = generateComposable(dependentFieldsData, minimalConfig)
      expect(result).toContain('dependentFieldComponents: {')
      expect(result).toContain("items: 'ShopProductsItemSelect'")
    })
  })

  describe('display config', () => {
    it('includes display config when provided', () => {
      const result = generateComposable(displayConfigData, minimalConfig)
      expect(result).toContain('display: {"title":"name","image":"photo","badge":"active","description":"description"}')
    })

    it('omits display config when not provided', () => {
      const result = generateComposable(basicComposableData, minimalConfig)
      expect(result).not.toContain('display:')
    })
  })

  describe('fields metadata', () => {
    it('includes runtime fields array with name, type, label', () => {
      const result = generateComposable(basicComposableData, minimalConfig)
      expect(result).toContain('fields: [')
      expect(result).toContain('"name": "name"')
      expect(result).toContain('"type": "string"')
      expect(result).toContain('"label": "Name"')
    })

    it('includes area when present in field meta', () => {
      const result = generateComposable(displayConfigData, minimalConfig)
      expect(result).toContain('"area": "main"')
      expect(result).toContain('"area": "sidebar"')
    })

    it('includes displayAs when present in field meta', () => {
      const result = generateComposable(displayConfigData, minimalConfig)
      expect(result).toContain('"displayAs": "badge"')
    })

    it('excludes id field from runtime fields', () => {
      const dataWithId = {
        ...basicComposableData,
        fields: [
          { name: 'id', type: 'string', meta: { primaryKey: true } },
          ...basicComposableData.fields
        ]
      }
      const result = generateComposable(dataWithId, minimalConfig)
      // Should not have a field entry for 'id'
      expect(result).not.toMatch(/"name": "id"/)
    })
  })
})
