import type { z } from 'zod'
import type { croutonRedirectSchema } from '../app/composables/useCroutonRedirects'

export interface CroutonRedirect {
  id: string
  teamId: string
  owner: string
  fromPath: string
  toPath: string
  statusCode: '301' | '302' | '307' | '308'
  isActive: boolean
  createdAt: Date
  updatedAt: Date
  createdBy: string
  updatedBy: string
  optimisticId?: string
  optimisticAction?: 'create' | 'update' | 'delete'
}

export type CroutonRedirectFormData = z.infer<typeof croutonRedirectSchema>
export type NewCroutonRedirect = Omit<CroutonRedirect, 'id' | 'createdAt' | 'updatedAt'>

export interface CroutonRedirectFormProps {
  items: string[]
  activeItem: CroutonRedirect | Record<string, never>
  collection: string
  loading: string
  action: 'create' | 'update' | 'delete'
}
