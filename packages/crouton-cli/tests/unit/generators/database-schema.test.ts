import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { generateSchema } from '../../../lib/generators/database-schema.ts'
import {
  schemaData,
  schemaWithHierarchyData,
  schemaWithAllTypesData,
  schemaWithSortableData,
  minimalConfig,
  noMetadataConfig,
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
  describe('date column defaults', () => {
    const base = (meta: Record<string, any>) => ({
      ...schemaData,
      fields: [{ name: 'publishedAt', type: 'date', meta }]
    })
    for (const dialect of ['sqlite', 'pg']) {
      it(`${dialect}: no $default on a user date column`, () => {
        const result = generateSchema(base({}), dialect, minimalConfig as AnyConfig)
        const line = result.split('\n').find(l => l.includes('publishedAt:'))!
        expect(line).toBeDefined()
        expect(line).not.toContain('$default')
      })

      it(`${dialect}: meta.default 'now' adds new Date()`, () => {
        const result = generateSchema(base({ default: 'now' }), dialect, minimalConfig as AnyConfig)
        expect(result).toContain('publishedAt')
        expect(result).toMatch(/publishedAt:.*\.\$default\(\(\) => new Date\(\)\)/)
      })

      it(`${dialect}: meta.default literal is wrapped in new Date()`, () => {
        const result = generateSchema(base({ default: '2025-01-01' }), dialect, minimalConfig as AnyConfig)
        expect(result).toContain('.$default(() => new Date("2025-01-01"))')
      })
    }
  })

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

    it('excludes metadata fields when disabled', () => {
      const result = generateSchema(schemaData, 'sqlite', noMetadataConfig as AnyConfig)
      expect(result).not.toContain("createdAt:")
      expect(result).not.toContain("updatedAt:")
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

  describe('PostgreSQL dialect', () => {
    it('generates correct schema for basic collection', () => {
      const result = generateSchema(schemaData, 'pg', minimalConfig as AnyConfig)
      expect(result).toMatchSnapshot()
    })

    it('includes correct imports for PostgreSQL', () => {
      const result = generateSchema(schemaData, 'pg', minimalConfig as AnyConfig)
      expect(result).toContain("import { pgTable, varchar, text, integer, numeric, boolean, timestamp, jsonb, uuid } from 'drizzle-orm/pg-core'")
    })

    it('generates uuid for primary key', () => {
      const result = generateSchema(schemaData, 'pg', minimalConfig as AnyConfig)
      expect(result).toContain("id: uuid('id').primaryKey().defaultRandom()")
    })

    describe('field type mappings', () => {
      it('maps boolean to boolean', () => {
        const result = generateSchema(schemaData, 'pg', minimalConfig as AnyConfig)
        expect(result).toContain("active: boolean('active')")
      })

      it('maps decimal to numeric', () => {
        const result = generateSchema(schemaData, 'pg', minimalConfig as AnyConfig)
        expect(result).toContain("price: numeric('price')")
      })

      it('maps date to timestamp with timezone', () => {
        const result = generateSchema(schemaWithAllTypesData, 'pg', minimalConfig as AnyConfig)
        expect(result).toContain("timestamp('publishedAt', { withTimezone: true })")
      })

      it('maps json/repeater/array to jsonb', () => {
        const result = generateSchema(schemaWithAllTypesData, 'pg', minimalConfig as AnyConfig)
        expect(result).toContain("metadata: jsonb('metadata')")
        expect(result).toContain("items: jsonb('items')")
        expect(result).toContain("tags: jsonb('tags')")
      })

      it('maps all field types correctly', () => {
        const result = generateSchema(schemaWithAllTypesData, 'pg', minimalConfig as AnyConfig)
        expect(result).toMatchSnapshot()
      })
    })

    it('includes hierarchy fields when enabled', () => {
      const result = generateSchema(schemaWithHierarchyData, 'pg', minimalConfig as AnyConfig)
      expect(result).toContain("parentId: text('parentId')")
      expect(result).toContain("path: text('path').notNull().default('/')")
      expect(result).toContain("depth: integer('depth').notNull().default(0)")
      expect(result).toContain("order: integer('order').notNull().default(0)")
    })

    it('generates correct export name', () => {
      const result = generateSchema(schemaData, 'pg', minimalConfig as AnyConfig)
      expect(result).toContain('export const shopProducts = pgTable')
    })

    it('generates correct table name in snake_case', () => {
      const result = generateSchema(schemaData, 'pg', minimalConfig as AnyConfig)
      expect(result).toContain("pgTable('shop_products'")
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

    it('handles maxLength for PostgreSQL varchar', () => {
      const dataWithMaxLength = {
        ...schemaData,
        fields: [
          { name: 'code', type: 'string', meta: { maxLength: 10 } }
        ]
      }
      const result = generateSchema(dataWithMaxLength, 'pg', minimalConfig as AnyConfig)
      expect(result).toContain("code: varchar('code', { length: 10 })")
    })
  })
})
