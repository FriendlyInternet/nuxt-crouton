import { nanoid } from 'nanoid'
import { sqliteTable, text, integer, real, customType } from 'drizzle-orm/sqlite-core'

// Custom JSON column that handles NULL values gracefully during LEFT JOINs
const jsonColumn = customType<any>({
  dataType() {
    return 'text'
  },
  fromDriver(value: unknown): any {
    if (value === null || value === undefined || value === '') {
      return null
    }
    try {
      return JSON.parse(value as string)
    } catch {
      return null
    }
  },
  toDriver(value: any): string {
    return JSON.stringify(value)
  },
})
// Note: This collection has translatable fields: title, street, zip, city, content
// Translations are stored in a JSON field without indexes for performance baseline

export const bookingsLocations = sqliteTable('bookings_locations', {
  id: text('id').primaryKey().$default(() => nanoid()),

  teamId: text('teamId').notNull(),
  owner: text('owner').notNull(),
  title: text('title').notNull(),
  color: text('color'),
  street: text('street'),
  zip: text('zip'),
  city: text('city'),
  location: text('location'),
  content: text('content'),
  allowedMemberIds: jsonColumn('allowedMemberIds').$default(() => (null)),
  slots: jsonColumn('slots').$default(() => (null)),
  openDays: jsonColumn('openDays').$default(() => (null)),
  slotSchedule: jsonColumn('slotSchedule').$default(() => ({})),
  blockedDates: jsonColumn('blockedDates').$default(() => (null)),
  inventoryMode: integer('inventoryMode', { mode: 'boolean' }).$default(() => false),
  quantity: integer('quantity'),
  maxBookingsPerMonth: integer('maxBookingsPerMonth'),
  // Note: No indexes on translations - measure performance first
  // Add indexes only if queries exceed 50ms with real data
  translations: jsonColumn('translations').$type<{
    [locale: string]: {
      title?: string
      street?: string
      zip?: string
      city?: string
      content?: string
    }
  }>(),

  createdAt: integer('createdAt', { mode: 'timestamp' }).notNull().$default(() => new Date()),
  updatedAt: integer('updatedAt', { mode: 'timestamp' }).notNull().$onUpdate(() => new Date()),
  createdBy: text('createdBy').notNull(),
  updatedBy: text('updatedBy').notNull()
})