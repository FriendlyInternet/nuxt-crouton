import { z } from 'zod'

export const bookingsSettingSchema = z.object({
  statuses: z.array(z.any()).optional(),
  enableGroups: z.boolean().optional(),
  groups: z.array(z.any()).optional(),
})

export const bookingsSettingsColumns = [
  { accessorKey: 'statuses', header: 'Statuses' },
  { accessorKey: 'enableGroups', header: 'Groups Enabled' },
  { accessorKey: 'groups', header: 'Groups' },
]

export const bookingsSettingsConfig = {
  name: 'bookingsSettings',
  layer: 'bookings',
  apiPath: 'bookings-settings',
  schema: bookingsSettingSchema,
  defaultValues: {
    statuses: [],
    enableGroups: false,
    groups: [],
  },
  columns: bookingsSettingsColumns,
  dependentFieldComponents: {
    statuses: 'BookingsSettingsStatuseSelect',
    groups: 'BookingsSettingsGroupSelect',
  },
}

export function useBookingsSettings() {
  return bookingsSettingsConfig
}

// Default export for auto-import compatibility
export default function () {
  return {
    defaultValue: bookingsSettingsConfig.defaultValues,
    schema: bookingsSettingsConfig.schema,
    columns: bookingsSettingsConfig.columns,
    collection: bookingsSettingsConfig.name,
  }
}
