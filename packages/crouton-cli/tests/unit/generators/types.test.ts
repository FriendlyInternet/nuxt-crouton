import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { generateTypes } from '../../../lib/generators/types.ts'
import {
  basicTypesData,
  minimalConfig,
  translationsConfig,
  noMetadataConfig
} from '../../fixtures/sample-data.mjs'

// Type helper to work around .mjs module inference (config = null default)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyConfig = any

// Mock date to prevent snapshot failures due to @generated timestamp
beforeAll(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2025-01-01'))
})

afterAll(() => {
  vi.useRealTimers()
})

describe('generateTypes', () => {
  it('generates correct types for basic collection', () => {
    const result = generateTypes(basicTypesData, minimalConfig as AnyConfig)
    expect(result).toMatchSnapshot()
  })

  it('includes AI context header', () => {
    const result = generateTypes(basicTypesData, minimalConfig as AnyConfig)
    expect(result).toContain('@crouton-generated')
    expect(result).toContain('@collection products')
    expect(result).toContain('@layer shop')
  })

  it('generates correct interface name with layer prefix', () => {
    const result = generateTypes(basicTypesData, minimalConfig as AnyConfig)
    expect(result).toContain('export interface ShopProduct {')
    expect(result).toContain('export type ShopProductFormData')
    expect(result).toContain('export type NewShopProduct')
    expect(result).toContain('export interface ShopProductFormProps')
  })

  it('includes team fields', () => {
    const result = generateTypes(basicTypesData, minimalConfig as AnyConfig)
    expect(result).toContain('teamId: string')
    expect(result).toContain('owner: string')
  })

  it('includes metadata fields when enabled', () => {
    const result = generateTypes(basicTypesData, minimalConfig as AnyConfig)
    expect(result).toContain('createdAt: Date')
    expect(result).toContain('updatedAt: Date')
    expect(result).toContain('createdBy: string')
    expect(result).toContain('updatedBy: string')
  })

  it('excludes metadata fields when disabled', () => {
    const result = generateTypes(basicTypesData, noMetadataConfig as AnyConfig)
    expect(result).not.toContain('createdAt: Date')
    expect(result).not.toContain('updatedAt: Date')
  })

  it('includes optimistic update fields', () => {
    const result = generateTypes(basicTypesData, minimalConfig as AnyConfig)
    expect(result).toContain('optimisticId?: string')
    expect(result).toContain("optimisticAction?: 'create' | 'update' | 'delete'")
  })

  it('generates correct import from composable', () => {
    const result = generateTypes(basicTypesData, minimalConfig as AnyConfig)
    expect(result).toContain("import type { shopProductSchema } from './app/composables/useShopProducts'")
  })

  it('handles translations when configured', () => {
    const result = generateTypes(basicTypesData, translationsConfig as AnyConfig)
    expect(result).toContain('translations?:')
    expect(result).toContain('locale?: string')
  })

  it('omits correct fields from New type', () => {
    const result = generateTypes(basicTypesData, minimalConfig as AnyConfig)
    expect(result).toContain("Omit<ShopProduct, 'id' | 'createdAt' | 'updatedAt' | 'createdBy' | 'updatedBy'>")
  })

  it('generates correct FormProps interface', () => {
    const result = generateTypes(basicTypesData, minimalConfig as AnyConfig)
    expect(result).toContain('items: string[]')
    expect(result).toContain('activeItem: ShopProduct | Record<string, never>')
    expect(result).toContain('collection: string')
    expect(result).toContain('loading?: string')
    expect(result).toContain("action: 'create' | 'update' | 'delete'")
  })
})
