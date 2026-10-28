import { z } from 'zod'

export const croutonRedirectSchema = z.object({
  fromPath: z.string().min(1, 'From path is required').startsWith('/', 'Path must start with /'),
  toPath: z.string().min(1, 'To path is required').startsWith('/', 'Path must start with /'),
  statusCode: z.enum(['301', '302']),
  isActive: z.boolean()
})

export const croutonRedirectsColumns = [
  { accessorKey: 'fromPath', header: 'From' },
  { accessorKey: 'toPath', header: 'To' },
  { accessorKey: 'statusCode', header: 'Status' },
  { accessorKey: 'isActive', header: 'Active' }
]

const _croutonRedirectsConfig = {
  name: 'croutonRedirects',
  layer: 'crouton',
  apiPath: 'crouton-redirects',
  display: {
    title: 'fromPath',
    subtitle: 'toPath',
    badge: 'statusCode'
  },
  defaultValues: {
    fromPath: '',
    toPath: '',
    statusCode: '301' as const,
    isActive: true
  },
  columns: croutonRedirectsColumns,
  fields: [
    {
      name: 'fromPath',
      type: 'string',
      label: 'From Path',
      area: 'main'
    },
    {
      name: 'toPath',
      type: 'string',
      label: 'To Path',
      area: 'main'
    },
    {
      name: 'statusCode',
      type: 'select',
      label: 'Status Code',
      area: 'sidebar'
    },
    {
      name: 'isActive',
      type: 'boolean',
      label: 'Active',
      area: 'sidebar'
    }
  ]
}

Object.defineProperty(_croutonRedirectsConfig, 'schema', {
  value: croutonRedirectSchema,
  enumerable: false,
  configurable: false,
  writable: false
})

export const croutonRedirectsConfig = _croutonRedirectsConfig as typeof _croutonRedirectsConfig & { schema: typeof croutonRedirectSchema }

export const useCroutonRedirects = () => croutonRedirectsConfig

export default function () {
  return {
    defaultValue: croutonRedirectsConfig.defaultValues,
    schema: croutonRedirectSchema,
    columns: croutonRedirectsConfig.columns,
    collection: croutonRedirectsConfig.name
  }
}
