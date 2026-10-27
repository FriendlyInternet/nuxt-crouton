import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { generateSchema } from '../../../lib/generators/database-schema.ts'
import {
  schemaData,
  schemaWithHierarchyData,
  schemaWithAllTypesData,
  schemaWithSortableData,
  minimalConfig,
  translationsConfig
} from '../../fixtures/sample-data.mjs'

// Type helper to work around .mjs module inference (config = null default)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyConfig = any

// Mock date to prevent snapshot failures due to timestamps
beforeAll(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2025-01-01'))
})

afterAll(() => {
  vi.useRealTimers()
})

describe('generateSchema', () => {
  describe('SQLite dialect', () => {
    it('generates correct schema for basic collection', () => {
      const result = generateSchema(schemaData, 'sqlite', minimalConfig as AnyConfig)
      expect(result).toMatchSnapshot()
    })

    it('includes correct imports for SQLite', () => {
      const result = generateSchema(schemaData, 'sqlite', minimalConfig as AnyConfig)
      expect(result).toContain("import { nanoid } from 'nanoid'")
      expect(result).toContain("import { sqliteTable, text, integer, real, customType } from 'drizzle-orm/sqlite-core'")
    })

    it('generates nanoid for primary key', () => {
      const result = generateSchema(schemaData, 'sqlite', minimalConfig as AnyConfig)
      expect(result).toContain("id: text('id').primaryKey().$default(() => nanoid())")
    })

    it('includes team fields', () => {
      const result = generateSchema(schemaData, 'sqlite', minimalConfig as AnyConfig)
      expect(result).toContain("teamId: text('teamId').notNull()")
      expect(result).toContain("owner: text('owner').notNull()")
    })

    it('includes metadata fields when enabled', () => {
      const result = generateSchema(schemaData, 'sqlite', minimalConfig as AnyConfig)
      expect(result).toContain("createdAt: integer('createdAt', { mode: 'timestamp' })")
      expect(result).toContain("updatedAt: integer('updatedAt', { mode: 'timestamp' })")
      expect(result).toContain("createdBy: text('createdBy').notNull()")
      expect(result).toContain("updatedBy: text('updatedBy').notNull()")
    })

    describe('field type mappings', () => {
      it('maps string to text', () => {
        const result = generateSchema(schemaData, 'sqlite', minimalConfig as AnyConfig)
        expect(result).toContain("name: text('name').notNull()")
      })

      it('maps text to text', () => {
        const result = generateSchema(schemaData, 'sqlite', minimalConfig as AnyConfig)
        expect(result).toContain("description: text('description')")
      })

      it('maps boolean to integer with mode boolean', () => {
        const result = generateSchema(schemaData, 'sqlite', minimalConfig as AnyConfig)
        expect(result).toContain("active: integer('active', { mode: 'boolean' })")
      })

      it('maps decimal to real', () => {
        const result = generateSchema(schemaData, 'sqlite', minimalConfig as AnyConfig)
        expect(result).toContain("price: real('price')")
      })

      it('maps all field types correctly', () => {
        const result = generateSchema(schemaWithAllTypesData, 'sqlite', minimalConfig as AnyConfig)
        expect(result).toMatchSnapshot()
        // Verify specific mappings
        expect(result).toContain("count: integer('count')")  // number
        expect(result).toContain("enabled: integer('enabled', { mode: 'boolean' })")  // boolean
        expect(result).toContain("publishedAt: integer('publishedAt', { mode: 'timestamp' })")  // date
        expect(result).toContain("metadata: jsonColumn('metadata')")  // json
        expect(result).toContain("items: jsonColumn('items')")  // repeater
        expect(result).toContain("tags: jsonColumn('tags')")  // array
      })
    })

    it('includes hierarchy fields when enabled', () => {
      const result = generateSchema(schemaWithHierarchyData, 'sqlite', minimalConfig as AnyConfig)
      expect(result).toContain("parentId: text('parentId')")
      expect(result).toContain("path: text('path').notNull()")
      expect(result).toContain("depth: integer('depth').notNull()")
      expect(result).toContain("order: integer('order').notNull()")
    })

    it('includes sortable field when enabled', () => {
      const result = generateSchema(schemaWithSortableData, 'sqlite', minimalConfig as AnyConfig)
      expect(result).toContain("order: integer('order').notNull()")
    })

    it('includes translations field when configured', () => {
      const result = generateSchema(schemaData, 'sqlite', translationsConfig as AnyConfig)
      expect(result).toContain("translations: jsonColumn('translations')")
      expect(result).toContain('[locale: string]')
    })

    it('generates correct export name', () => {
      const result = generateSchema(schemaData, 'sqlite', minimalConfig as AnyConfig)
      expect(result).toContain('export const shopProducts = sqliteTable')
    })

    it('generates correct table name in snake_case', () => {
      const result = generateSchema(schemaData, 'sqlite', minimalConfig as AnyConfig)
      expect(result).toContain("sqliteTable('shop_products'")
    })
  })

  describe('constraint handling', () => {
    it('handles required fields with notNull', () => {
      const result = generateSchema(schemaData, 'sqlite', minimalConfig as AnyConfig)
      expect(result).toContain("name: text('name').notNull()")
    })

    it('handles unique fields', () => {
      const dataWithUnique = {
        ...schemaData,
        fields: [
          { name: 'email', type: 'string', meta: { required: true, unique: true } }
        ]
      }
      const result = generateSchema(dataWithUnique, 'sqlite', minimalConfig as AnyConfig)
      expect(result).toContain("email: text('email').notNull()")
      expect(result).toContain("uniqueIndex('shop_products_team_email_idx').on(table.teamId, table.email)")
    })

  })
})
