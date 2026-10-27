import { sql } from 'drizzle-orm'
import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core'

export const croutonOperations = sqliteTable('crouton_operations', {
  id: text('id').primaryKey(),
  timestamp: integer('timestamp', { mode: 'timestamp' }).notNull(),
  /** Dot-namespaced type, e.g. 'auth:login', 'email:sent' */
  type: text('type').notNull(),
  /** Package that emitted the event, e.g. 'crouton-auth', 'crouton-ai' */
  source: text('source').notNull(),
  teamId: text('team_id'),
  userId: text('user_id'),
  correlationId: text('correlation_id'),
  metadata: text('metadata', { mode: 'json' }).$type<Record<string, any>>()
})


interface EventChange {
  fieldName: string
  oldValue: string | null
  newValue: string | null
}

export const croutonEvents = sqliteTable('crouton_events', {
  id: text('id').primaryKey(),
  timestamp: integer('timestamp', { mode: 'timestamp' }).notNull(),
  operation: text('operation', { enum: ['create', 'update', 'delete'] }).notNull(),
  collectionName: text('collection_name').notNull(),
  itemId: text('item_id').notNull(),
  teamId: text('team_id').notNull(),
  userId: text('user_id').notNull(),
  userName: text('user_name').notNull().default(''),
  changes: text('changes', { mode: 'json' }).$type<EventChange[]>().notNull().default(sql`'[]'`),
  metadata: text('metadata', { mode: 'json' }).$type<Record<string, any>>()
})
