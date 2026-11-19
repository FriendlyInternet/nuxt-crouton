/**
 * @collection products
 * @layer catalog
 *
 * ## AI Context
 * - Main interface: CatalogProduct
 * - Form data type: CatalogProductFormData
 * - New item type: NewCatalogProduct
 * - Form props: CatalogProductFormProps
 * - Fields: title, description, active
 */

import type { z } from 'zod'
import type { catalogProductSchema } from './app/composables/useCatalogProducts'

export interface CatalogProduct {
  id: string
  teamId: string
  owner: string
  order?: number
  title: string
  description?: string | null
  active?: boolean | null
  translations?: Record<string, { title?: string; description?: string }> | null
  locale?: string
  createdAt: Date
  updatedAt: Date
  createdBy: string
  updatedBy: string
  optimisticId?: string
  optimisticAction?: 'create' | 'update' | 'delete'
}

export type CatalogProductFormData = z.infer<typeof catalogProductSchema>
export type NewCatalogProduct = Omit<CatalogProduct, 'id' | 'createdAt' | 'updatedAt'>

// Props type for the Form component
export interface CatalogProductFormProps {
  items: string[] // Array of IDs for delete action
  activeItem: CatalogProduct | Record<string, never> // CatalogProduct for update, empty object for create
  collection: string
  loading: string
  action: 'create' | 'update' | 'delete'
}
