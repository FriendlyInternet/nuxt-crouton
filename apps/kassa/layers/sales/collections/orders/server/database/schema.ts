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

export const salesOrders = sqliteTable('sales_orders', {
  id: text('id').primaryKey().$default(() => nanoid()),

  teamId: text('teamId').notNull(),
  owner: text('owner').notNull(),
  eventId: text('eventId').notNull(),
  clientId: text('clientId'),
  clientName: text('clientName'),
  eventOrderNumber: integer('eventOrderNumber'),
  overallRemarks: text('overallRemarks'),
  locationRemarks: jsonColumn('locationRemarks').$default(() => ({})),
  isPersonnel: integer('isPersonnel', { mode: 'boolean' }).$default(() => false),
  status: text('status').notNull(),

  createdAt: integer('createdAt', { mode: 'timestamp' }).notNull().$default(() => new Date()),
  updatedAt: integer('updatedAt', { mode: 'timestamp' }).notNull().$onUpdate(() => new Date()),
  createdBy: text('createdBy').notNull(),
  updatedBy: text('updatedBy').notNull()
})