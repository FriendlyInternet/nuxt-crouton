import { describe, it, expect } from 'vitest'

import {
  translationsUiSchema,
  TRANSLATIONS_UI_COLUMNS,
  TRANSLATIONS_UI_DEFAULTS,
  TRANSLATIONS_UI_PAGINATION,
  TRANSLATIONS_UI_COLLECTION,
  translationsUiConfig
} from '../useTranslationsUi'

describe('translationsUi', () => {
  describe('TRANSLATIONS_UI_COLLECTION', () => {
    it('equals translationsUi', () => {
      expect(TRANSLATIONS_UI_COLLECTION).toBe('translationsUi')
    })
  })

  describe('translationsUiSchema', () => {
    it('validates valid translation data', () => {
      const validData = {
        keyPath: 'common.save',
        category: 'common',
        values: { en: 'Save', nl: 'Opslaan' },
        description: 'Save button label'
      }
      const result = translationsUiSchema.safeParse(validData)
      expect(result.success).toBe(true)
    })

    it('requires keyPath', () => {
      const invalidData = {
        category: 'common',
        values: { en: 'Save' }
      }
      const result = translationsUiSchema.safeParse(invalidData)
      expect(result.success).toBe(false)
    })

    it('requires non-empty keyPath', () => {
      const invalidData = {
        keyPath: '',
        category: 'common',
        values: { en: 'Save' }
      }
      const result = translationsUiSchema.safeParse(invalidData)
      expect(result.success).toBe(false)
    })

    it('requires category', () => {
      const invalidData = {
        keyPath: 'common.save',
        values: { en: 'Save' }
      }
      const result = translationsUiSchema.safeParse(invalidData)
      expect(result.success).toBe(false)
    })

    it('requires non-empty category', () => {
      const invalidData = {
        keyPath: 'common.save',
        category: '',
        values: { en: 'Save' }
      }
      const result = translationsUiSchema.safeParse(invalidData)
      expect(result.success).toBe(false)
    })

    it('requires English translation in values', () => {
      const invalidData = {
        keyPath: 'common.save',
        category: 'common',
        values: { nl: 'Opslaan', fr: 'Sauvegarder' }
      }
      const result = translationsUiSchema.safeParse(invalidData)
      expect(result.success).toBe(false)
    })

    it('requires non-empty English translation', () => {
      const invalidData = {
        keyPath: 'common.save',
        category: 'common',
        values: { en: '', nl: 'Opslaan' }
      }
      const result = translationsUiSchema.safeParse(invalidData)
      expect(result.success).toBe(false)
    })

    it('requires non-whitespace English translation', () => {
      const invalidData = {
        keyPath: 'common.save',
        category: 'common',
        values: { en: '   ', nl: 'Opslaan' }
      }
      const result = translationsUiSchema.safeParse(invalidData)
      expect(result.success).toBe(false)
    })

    it('allows optional description', () => {
      const validData = {
        keyPath: 'common.save',
        category: 'common',
        values: { en: 'Save' }
      }
      const result = translationsUiSchema.safeParse(validData)
      expect(result.success).toBe(true)
    })

    it('allows null description', () => {
      const validData = {
        keyPath: 'common.save',
        category: 'common',
        values: { en: 'Save' },
        description: null
      }
      const result = translationsUiSchema.safeParse(validData)
      expect(result.success).toBe(true)
    })

    it('defaults namespace to ui', () => {
      const validData = {
        keyPath: 'common.save',
        category: 'common',
        values: { en: 'Save' }
      }
      const result = translationsUiSchema.safeParse(validData)
      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.namespace).toBe('ui')
      }
    })

    it('allows custom namespace', () => {
      const validData = {
        keyPath: 'common.save',
        category: 'common',
        values: { en: 'Save' },
        namespace: 'content'
      }
      const result = translationsUiSchema.safeParse(validData)
      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.namespace).toBe('content')
      }
    })

    it('defaults isOverrideable to true', () => {
      const validData = {
        keyPath: 'common.save',
        category: 'common',
        values: { en: 'Save' }
      }
      const result = translationsUiSchema.safeParse(validData)
      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.isOverrideable).toBe(true)
      }
    })

    it('allows isOverrideable to be set to false', () => {
      const validData = {
        keyPath: 'common.save',
        category: 'common',
        values: { en: 'Save' },
        isOverrideable: false
      }
      const result = translationsUiSchema.safeParse(validData)
      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.isOverrideable).toBe(false)
      }
    })
  })

  describe('TRANSLATIONS_UI_COLUMNS', () => {
    it('contains expected columns', () => {
      const columnKeys = TRANSLATIONS_UI_COLUMNS.map(col => col.key)

      expect(columnKeys).toContain('keyPath')
      expect(columnKeys).toContain('category')
      expect(columnKeys).toContain('values')
      expect(columnKeys).toContain('description')
      expect(columnKeys).toContain('actions')
    })

    it('has label for each column', () => {
      TRANSLATIONS_UI_COLUMNS.forEach(col => {
        expect(col).toHaveProperty('label')
        expect(typeof col.label).toBe('string')
      })
    })
  })

  describe('TRANSLATIONS_UI_DEFAULTS', () => {
    it('has empty keyPath', () => {
      expect(TRANSLATIONS_UI_DEFAULTS.keyPath).toBe('')
    })

    it('has empty category', () => {
      expect(TRANSLATIONS_UI_DEFAULTS.category).toBe('')
    })

    it('has ui namespace', () => {
      expect(TRANSLATIONS_UI_DEFAULTS.namespace).toBe('ui')
    })

    it('has empty values for supported locales', () => {
      expect(TRANSLATIONS_UI_DEFAULTS.values).toEqual({ en: '', nl: '', fr: '' })
    })

    it('has isOverrideable set to true', () => {
      expect(TRANSLATIONS_UI_DEFAULTS.isOverrideable).toBe(true)
    })
  })

  describe('TRANSLATIONS_UI_PAGINATION', () => {
    it('starts at page 1', () => {
      expect(TRANSLATIONS_UI_PAGINATION.currentPage).toBe(1)
    })

    it('has page size of 10', () => {
      expect(TRANSLATIONS_UI_PAGINATION.pageSize).toBe(10)
    })

    it('sorts by keyPath', () => {
      expect(TRANSLATIONS_UI_PAGINATION.sortBy).toBe('keyPath')
    })

    it('sorts ascending', () => {
      expect(TRANSLATIONS_UI_PAGINATION.sortDirection).toBe('asc')
    })
  })

  describe('translationsUiConfig', () => {
    it('has correct name', () => {
      expect(translationsUiConfig.name).toBe('translationsUi')
    })

    it('has correct apiPath', () => {
      expect(translationsUiConfig.apiPath).toBe('translations-ui')
    })

    it('has displayName', () => {
      expect(translationsUiConfig.displayName).toBe('UI Translations')
    })

    it('has singularName', () => {
      expect(translationsUiConfig.singularName).toBe('Translation')
    })

    it('has componentName', () => {
      expect(translationsUiConfig.componentName).toBe('TranslationsUiForm')
    })

    it('has schema as non-enumerable property', () => {
      const descriptor = Object.getOwnPropertyDescriptor(translationsUiConfig, 'schema')

      expect(descriptor?.enumerable).toBe(false)
    })

    it('schema is accessible despite being non-enumerable', () => {
      expect(translationsUiConfig.schema).toBeDefined()
      expect(translationsUiConfig.schema).toBe(translationsUiSchema)
    })
  })
})
