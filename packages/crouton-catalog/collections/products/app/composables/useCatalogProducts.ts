/**
 * @collection products
 * @layer catalog
 *
 * ## AI Context
 * - Composable: useCatalogProducts
 * - Collection name: catalogProducts
 * - API endpoint: /api/teams/[id]/catalog-products
 * - Form component: CatalogProductsForm (collections/products/app/components/_Form.vue)
 * - List component: CatalogProductsList
 * - Fields: title, description, active
 */

import { z } from 'zod'
import { formRequiredLocale, type FormI18n } from '../../../../required-locale'

// Schema exported separately - Zod 4 schemas cannot survive deep cloning
// Keep schema outside of objects that might be serialized/cloned during SSR.
// The required translation is the app's default language (same rule as the
// translation input), so the form schema is built per language.
export const catalogProductSchemaFor = (locale: string) => z.object({
  title: z.string().optional(),
  description: z.string().nullish(),
  active: z.boolean().optional(),
  translations: z.record(
    z.string(),
    z.object({
      title: z.string().min(1, 'Title is required'),
      description: z.string().optional()
    })
  ).refine(
    translations => !!translations[locale]?.title,
    { message: `Translations for title (${locale}) are required` }
  )
})

export const catalogProductSchema = catalogProductSchemaFor('en')

export const catalogProductsColumns = [
  { accessorKey: 'title', header: 'Title' },
  { accessorKey: 'active', header: 'Active' }
]

// Config object WITHOUT schema - safe for SSR serialization
const _catalogProductsConfig = {
  name: 'catalogProducts',
  layer: 'catalog',
  apiPath: 'catalog-products',
  defaultValues: {
    title: '',
    description: '',
    active: true,
    translations: {}
  },
  columns: catalogProductsColumns,
  fields: [
    {
      name: 'title',
      type: 'string',
      label: 'Title',
      area: 'main'
    },
    {
      name: 'description',
      type: 'text',
      label: 'Description',
      area: 'main'
    },
    {
      name: 'active',
      type: 'boolean',
      label: 'Active',
      area: 'sidebar'
    }
  ],
}

// Add schema as non-enumerable property so klona skips it during cloning
Object.defineProperty(_catalogProductsConfig, 'schema', {
  value: catalogProductSchema,
  enumerable: false,
  configurable: false,
  writable: false
})

export const catalogProductsConfig = _catalogProductsConfig as typeof _catalogProductsConfig & { schema: typeof catalogProductSchema }

export const useCatalogProducts = () => catalogProductsConfig

// Default export for auto-import compatibility
// The form passes its `useI18n()` in; the schema requires that app's default
// language (no i18n passed → English).
export default function (i18n?: FormI18n) {
  const locale = formRequiredLocale(i18n)
  return {
    defaultValue: catalogProductsConfig.defaultValues,
    schema: catalogProductSchemaFor(locale),
    columns: catalogProductsConfig.columns,
    collection: catalogProductsConfig.name
  }
}
