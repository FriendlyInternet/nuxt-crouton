import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { generateFormComponent } from '../../../lib/generators/form-component.ts'
import {
  formComponentData,
  formWithHierarchyData,
  formWithRefsData,
  formWithDateData,
  minimalConfig,
  translationsConfig,
  allTypesFields,
  withComponent
} from '../../fixtures/sample-data.mjs'

// Mock date to prevent snapshot failures due to @generated timestamp
beforeAll(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2025-01-01'))
})

afterAll(() => {
  vi.useRealTimers()
})

describe('generateFormComponent', () => {
  it('generates correct output for basic collection', () => {
    const result = generateFormComponent(formComponentData, minimalConfig)
    expect(result).toMatchSnapshot()
  })

  it('includes AI context header', () => {
    const result = generateFormComponent(formComponentData, minimalConfig)
    expect(result).toContain('@crouton-generated')
    expect(result).toContain('@collection products')
    expect(result).toContain('@layer shop')
  })

  it('generates correct component structure', () => {
    const result = generateFormComponent(formComponentData, minimalConfig)
    // Template structure
    expect(result).toContain('<template>')
    expect(result).toContain('</template>')
    expect(result).toContain('<script setup lang="ts">')
    expect(result).toContain('</script>')
    // Form components
    expect(result).toContain('<UForm')
    expect(result).toContain('<CroutonFormLayout')
    expect(result).toContain('<CroutonFormActionButton')
  })

  it('imports types and composables correctly', () => {
    const result = generateFormComponent(formComponentData, minimalConfig)
    expect(result).toContain("import type { ShopProductFormProps, ShopProductFormData } from '../../types'")
    expect(result).toContain('import useShopProducts from')
  })

  it('normalizes DB nulls to field defaults on init (#1415)', () => {
    // Nullable columns round-trip null (#1403); a raw { ...defaultValue,
    // ...activeItem } spread would let null overwrite the form default,
    // making FormData a runtime lie and tripping the strict client schema
    // on submit for fields the user never touched. The emitted form must
    // fall back to the field default for null values — generically, so
    // fields whose default IS null (dates, dependent fields) are a no-op.
    const result = generateFormComponent(formComponentData, minimalConfig)
    expect(result).toContain('...defaultValue, ...props.activeItem')
    expect(result).toContain('if (initialRecord[key] === null && defaultRecord[key] !== null)')
    expect(result).toContain('initialRecord[key] = defaultRecord[key]')
  })

  describe('field type rendering', () => {
    it('renders string fields with UInput', () => {
      const result = generateFormComponent(formComponentData, minimalConfig)
      expect(result).toContain('<UInput v-model="state.name"')
    })

    it('renders text fields with UTextarea', () => {
      const result = generateFormComponent(formComponentData, minimalConfig)
      expect(result).toContain('<UTextarea v-model="state.description"')
    })

    it('renders boolean fields with UCheckbox', () => {
      const result = generateFormComponent(formComponentData, minimalConfig)
      expect(result).toContain('<UCheckbox v-model="state.active"')
    })

    it('renders number/decimal fields with UInputNumber', () => {
      const result = generateFormComponent(formComponentData, minimalConfig)
      expect(result).toContain('<UInputNumber v-model="state.price"')
    })

    it('renders date fields with CroutonCalendar', () => {
      const result = generateFormComponent(formWithDateData, minimalConfig)
      expect(result).toContain('<CroutonCalendar v-model:date="state.publishedAt"')
    })
  })

  describe('reference field handling', () => {
    it('renders reference fields with CroutonFormReferenceSelect', () => {
      const result = generateFormComponent(formWithRefsData, minimalConfig)
      expect(result).toContain('<CroutonFormReferenceSelect')
      expect(result).toContain('v-model="state.categoryId"')
      expect(result).toContain('collection="shopCategories"')
    })
  })

  describe('hierarchy support', () => {
    it('includes parent picker section for hierarchy-enabled collections', () => {
      const result = generateFormComponent(formWithHierarchyData, minimalConfig)
      expect(result).toContain('<CroutonFormParentSelect')
      expect(result).toContain('v-model="state.parentId"')
      expect(result).toContain('collection="shopCategories"')
    })

    it('includes hierarchy defaults in script', () => {
      const result = generateFormComponent(formWithHierarchyData, minimalConfig)
      expect(result).toContain('hierarchyDefaults')
      expect(result).toContain('parentId: null')
    })
  })

  describe('translations support', () => {
    it('renders CroutonI18nInput when translations configured', () => {
      const result = generateFormComponent(formComponentData, translationsConfig)
      expect(result).toContain('<CroutonI18nInput')
      expect(result).toContain("v-model=\"state.translations\"")
      expect(result).toContain(":fields=\"['name', 'description']\"")
    })

    it('separates translatable fields from regular fields', () => {
      const result = generateFormComponent(formComponentData, translationsConfig)
      // When translations are configured, 'name' and 'description' are handled by CroutonI18nInput
      // So they shouldn't appear as regular UFormField entries
      expect(result).toContain('<CroutonI18nInput')
      expect(result).toContain(":default-values=\"{")
      expect(result).toContain("name: state.name || ''")
    })
  })

  describe('date field handling', () => {
    it('includes date conversion code for date fields', () => {
      const result = generateFormComponent(formWithDateData, minimalConfig)
      expect(result).toContain('new Date(initialValues.publishedAt)')
      expect(result).toContain('toISOString()')
    })
  })

  describe('form state initialization', () => {
    it('uses defaultValue from composable for initial state', () => {
      const result = generateFormComponent(formComponentData, minimalConfig)
      // Form uses defaultValue from composable
      expect(result).toContain('const { defaultValue, schema, collection }')
      expect(result).toContain('{ ...defaultValue, ...props.activeItem }')
      expect(result).toContain('{ ...defaultValue }')
    })

    it('generates ref for state with correct type', () => {
      const result = generateFormComponent(formComponentData, minimalConfig)
      expect(result).toContain('const state = ref<ShopProductFormData & { id?: string | null }>(initialValues as ShopProductFormData & { id?: string | null })')
    })
  })

  describe('all field types', () => {
    it('generates form for all field types', () => {
      const dataWithAllTypes = {
        ...formComponentData,
        fields: allTypesFields
      }
      const result = generateFormComponent(dataWithAllTypes, minimalConfig)
      expect(result).toMatchSnapshot()
    })

    it('renders repeater fields with CroutonFormRepeater', () => {
      const dataWithRepeater = {
        ...formComponentData,
        fields: withComponent([
          { name: 'name', type: 'string', meta: { required: true } },
          { name: 'items', type: 'repeater', meta: {} }
        ])
      }
      const result = generateFormComponent(dataWithRepeater, minimalConfig)
      expect(result).toContain('<CroutonFormRepeater')
      expect(result).toContain('v-model="state.items"')
    })

    it('renders json fields with textarea', () => {
      const dataWithJson = {
        ...formComponentData,
        fields: withComponent([
          { name: 'name', type: 'string', meta: { required: true } },
          { name: 'metadata', type: 'json', meta: {} }
        ])
      }
      const result = generateFormComponent(dataWithJson, minimalConfig)
      expect(result).toContain('<UTextarea')
      expect(result).toContain('JSON.stringify(state.metadata')
    })

    it('renders array fields without refTarget', () => {
      const dataWithArray = {
        ...formComponentData,
        fields: withComponent([
          { name: 'name', type: 'string', meta: { required: true } },
          { name: 'tags', type: 'array', meta: {} }
        ])
      }
      const result = generateFormComponent(dataWithArray, minimalConfig)
      expect(result).toContain('state.tags.join')
      expect(result).toContain('Enter one value per line')
    })
  })

  describe('manifest-declared form component (#2286)', () => {
    // A field carries `component` from the manifest (attached by loadFields).
    // The generator must render THAT, not a private type→component switch.
    it('renders the field\'s manifest component instead of a type-keyed default', () => {
      const data = {
        ...formComponentData,
        fields: [{ name: 'color', type: 'string', component: 'UColorPicker', meta: {} }]
      }
      const result = generateFormComponent(data, minimalConfig)
      expect(result).toContain('<UColorPicker v-model="state.color"')
      expect(result).not.toContain('<UInput v-model="state.color"')
    })

    it('falls back to UInput when a field carries no component (manifest-less path)', () => {
      const data = {
        ...formComponentData,
        fields: [{ name: 'name', type: 'string', meta: {} }]
      }
      const result = generateFormComponent(data, minimalConfig)
      expect(result).toContain('<UInput v-model="state.name"')
    })

    it('keeps the type-specific bindings when the manifest names a known control', () => {
      // CroutonCalendar binds v-model:date, the repeater needs component-name,
      // image needs :crop — the component decides the markup, the type only
      // decides data-shape specials (json/array serialisation).
      const data = {
        ...formComponentData,
        fields: [
          { name: 'when', type: 'date', component: 'CroutonCalendar', meta: {} },
          { name: 'cover', type: 'image', component: 'CroutonImageUpload', meta: {} },
          { name: 'meta', type: 'json', component: 'UTextarea', meta: {} }
        ]
      }
      const result = generateFormComponent(data, minimalConfig)
      expect(result).toContain('<CroutonCalendar v-model:date="state.when"')
      expect(result).toContain(':crop="true"')
      expect(result).toContain('JSON.stringify(state.meta')
    })
  })
})
