import { nanoid } from 'nanoid'
import { sqliteTable, text, integer, index } from 'drizzle-orm/sqlite-core'

/**
 * layout_configs — persisted layout trees (Sprint 0 spike, #713).
 *
 * A saved layout = renderer id + a tree of placed blocks (+ per-block config),
 * stored as JSON, decoupled from any collection schema. Team-scoped; this is the
 * NEW table for the layout engine — deliberately separate from crouton-flow's
 * `flow_configs` (no migration / overload of that table).
 */
export const layoutConfigs = sqliteTable('layout_configs', {
  id: text('id').primaryKey().$default(() => nanoid()),
  teamId: text('teamId').notNull(),
  name: text('name').notNull().$default(() => 'untitled'),
  renderer: text('renderer').notNull().$default(() => 'panes'),
  // The layout tree (see app/types/layout.ts LayoutTree). JSON column.
  tree: text('tree', { mode: 'json' }).$type<Record<string, unknown>>(),
  createdAt: integer('createdAt', { mode: 'timestamp' }).notNull().$default(() => new Date()),
  updatedAt: integer('updatedAt', { mode: 'timestamp' }).notNull().$onUpdate(() => new Date()),
}, (table) => [
  index('layout_configs_team_idx').on(table.teamId),
])
