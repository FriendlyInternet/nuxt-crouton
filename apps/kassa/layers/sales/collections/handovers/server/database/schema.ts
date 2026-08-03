import { nanoid } from 'nanoid'
import { sqliteTable, text, integer, real, customType, uniqueIndex } from 'drizzle-orm/sqlite-core'

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

export const salesHandovers = sqliteTable('sales_handovers', {
  id: text('id').primaryKey().$default(() => nanoid()),

  teamId: text('teamId').notNull(),
  owner: text('owner').notNull(),
  eventId: text('eventId').notNull(),
  orderId: text('orderId').notNull(),

  createdAt: integer('createdAt', { mode: 'timestamp' }).notNull().$default(() => new Date()),
  updatedAt: integer('updatedAt', { mode: 'timestamp' }).notNull().$onUpdate(() => new Date()),
  createdBy: text('createdBy').notNull(),
  updatedBy: text('updatedBy').notNull()
}, (table) => [
  uniqueIndex('sales_handovers_team_order_id_idx').on(table.teamId, table.orderId)
])