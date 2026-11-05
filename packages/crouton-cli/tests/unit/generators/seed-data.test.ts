import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { generateSeedFile } from '../../../lib/generators/seed-data.ts'
import { withManifest } from '../../helpers/manifest-fields.ts'
import {
  seedData as rawSeedData,
  seedWithHierarchyData,
  seedWithForeignKeyData
} from '../../fixtures/sample-data.mjs'

const seedData = { ...rawSeedData, fields: withManifest(rawSeedData.fields) }

// Mock date to prevent snapshot failures due to timestamps
beforeAll(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2025-01-01'))
})

afterAll(() => {
  vi.useRealTimers()
})

describe('generateSeedFile', () => {
  it('generates correct output for basic collection', () => {
    const result = generateSeedFile(seedData, {})
    expect(result).toMatchSnapshot()
  })

  it('includes crouton-generated header', () => {
    const result = generateSeedFile(seedData, {})
    expect(result).toContain('@crouton-generated seed file')
    expect(result).toContain('Layer: shop')
    expect(result).toContain('Collection: products')
  })

  it('includes drizzle-seed imports', () => {
    const result = generateSeedFile(seedData, {})
    expect(result).toContain("import { seed, reset } from 'drizzle-seed'")
    expect(result).toContain("import { drizzle } from 'drizzle-orm/libsql'")
    expect(result).toContain("import { createClient } from '@libsql/client'")
  })

  it('includes correct table import', () => {
    const result = generateSeedFile(seedData, {})
    expect(result).toContain("import { shopProducts } from './schema'")
  })

  it('generates SeedOptions interface', () => {
    const result = generateSeedFile(seedData, {})
    expect(result).toContain('export interface SeedOptions {')
    expect(result).toContain('count?: number')
    expect(result).toContain('teamId?: string')
    expect(result).toContain('reset?: boolean')
    expect(result).toContain('db?: ReturnType<typeof drizzle>')
  })

  it('generates correct function name', () => {
    const result = generateSeedFile(seedData, {})
    expect(result).toContain('export async function seedShopProducts(options: SeedOptions = {})')
  })

  describe('field name detection', () => {
    it('detects email field and uses f.email()', () => {
      const result = generateSeedFile(seedData, {})
      expect(result).toContain('email: f.email()')
    })

    it('detects fullName field and uses f.fullName()', () => {
      const result = generateSeedFile(seedData, {})
      expect(result).toContain('fullName: f.fullName()')
    })

    it('detects firstName field and uses f.firstName()', () => {
      const result = generateSeedFile(seedData, {})
      expect(result).toContain('firstName: f.firstName()')
    })

    it('detects lastName field and uses f.lastName()', () => {
      const result = generateSeedFile(seedData, {})
      expect(result).toContain('lastName: f.lastName()')
    })

    it('detects title field and uses loremIpsum', () => {
      const result = generateSeedFile(seedData, {})
      expect(result).toContain('title: f.loremIpsum({ sentencesCount: 1 })')
    })

    it('detects description field and uses loremIpsum', () => {
      const result = generateSeedFile(seedData, {})
      expect(result).toContain('description: f.loremIpsum({ sentencesCount: 3 })')
    })

    it('detects phone field and uses f.phoneNumber()', () => {
      const result = generateSeedFile(seedData, {})
      expect(result).toContain('phone: f.phoneNumber()')
    })

    it('detects website field and uses valuesFromArray', () => {
      const result = generateSeedFile(seedData, {})
      expect(result).toContain('website: f.valuesFromArray({ values: ["https://example.com"] })')
    })

    it('detects price field and uses number with precision', () => {
      const result = generateSeedFile(seedData, {})
      expect(result).toContain('price: f.number({ minValue: 1, maxValue: 1000, precision: 100 })')
    })

    it('uses default generator for unknown fields', () => {
      const result = generateSeedFile(seedData, {})
      expect(result).toContain('unknownField: f.loremIpsum({ sentencesCount: 1 })')
    })

    it('handles boolean fields with weightedRandom', () => {
      const result = generateSeedFile(seedData, {})
      expect(result).toContain('isActive: f.weightedRandom')
    })

    it('handles json fields with valuesFromArray', () => {
      const result = generateSeedFile(seedData, {})
      expect(result).toContain('settings: f.valuesFromArray({ values: [{}] })')
    })
  })

  describe('foreign key placeholder comments', () => {
    it('adds placeholder comment for reference fields', () => {
      const result = generateSeedFile(seedWithForeignKeyData, {})
      expect(result).toContain("// NOTE: categoryId references 'categories'")
      expect(result).toContain('placeholder-categories-id')
    })
  })

  describe('hierarchy support', () => {
    it('includes hierarchy note when enabled', () => {
      const result = generateSeedFile(seedWithHierarchyData, {})
      expect(result).toContain('NOTE: Hierarchy fields (parentId, path, depth, order) are handled automatically')
      expect(result).toContain('All seeded records will be root items')
    })
  })

  describe('configuration options', () => {
    it('uses custom seedCount from config in default value', () => {
      const result = generateSeedFile(seedData, { seedCount: 100 })
      expect(result).toContain('count?: number')
      // The default is embedded in the const assignment
      expect(result).toContain('const count = options.count ?? 100')
    })

    it('uses custom teamId from config in default value', () => {
      const result = generateSeedFile(seedData, { teamId: 'custom-team' })
      // The default is embedded in the const assignment
      expect(result).toContain("const teamId = options.teamId ?? 'custom-team'")
    })
  })

  describe('team scoping', () => {
    it('includes teamId field mapping', () => {
      const result = generateSeedFile(seedData, {})
      expect(result).toContain('teamId: f.valuesFromArray({ values: [teamId] })')
    })

    it('includes owner field mapping', () => {
      const result = generateSeedFile(seedData, {})
      expect(result).toContain("owner: f.valuesFromArray({ values: ['seed-script'] })")
    })

    it('includes audit fields', () => {
      const result = generateSeedFile(seedData, {})
      expect(result).toContain("createdBy: f.valuesFromArray({ values: ['seed-script'] })")
      expect(result).toContain("updatedBy: f.valuesFromArray({ values: ['seed-script'] })")
    })
  })

  describe('standalone execution', () => {
    it('includes main module detection', () => {
      const result = generateSeedFile(seedData, {})
      expect(result).toContain('const isMainModule')
      expect(result).toContain('Bun.main')
      expect(result).toContain('import.meta.url')
    })

    it('includes standalone execution block', () => {
      const result = generateSeedFile(seedData, {})
      expect(result).toContain('if (isMainModule)')
      expect(result).toContain('seedShopProducts()')
      expect(result).toContain("console.log('Seed complete!')")
    })
  })

  describe('database connection', () => {
    it('includes createDb function', () => {
      const result = generateSeedFile(seedData, {})
      expect(result).toContain('function createDb()')
      expect(result).toContain('process.env.DATABASE_URL')
      expect(result).toContain('createClient({ url })')
    })
  })
})
