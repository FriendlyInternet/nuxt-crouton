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

// Schema exported separately - Zod 4 schemas cannot survive deep cloning
// Keep schema outside of objects that might be serialized/cloned during SSR
export const catalogProductSchema = z.object({
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
    translations => translations.en && translations.en.title,
    { message: 'English translations for title are required' }
  )
})

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
export default function () {
  return {
    defaultValue: catalogProductsConfig.defaultValues,
    schema: catalogProductSchema,
    columns: catalogProductsConfig.columns,
    collection: catalogProductsConfig.name
  }
}
