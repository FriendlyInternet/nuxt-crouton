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

export const triageTasks = sqliteTable('triage_tasks', {
  id: text('id').primaryKey().$default(() => nanoid()),

  teamId: text('teamId').notNull(),
  owner: text('owner').notNull(),

  order: integer('order').notNull().$default(() => 0),
  discussionId: text('discussionId').notNull(),
  syncJobId: text('syncJobId').notNull(),
  notionPageId: text('notionPageId').notNull(),
  notionPageUrl: text('notionPageUrl').notNull(),
  title: text('title').notNull(),
  description: text('description'),
  status: text('status').notNull(),
  priority: text('priority'),
  assignee: text('assignee'),
  summary: text('summary'),
  sourceUrl: text('sourceUrl').notNull(),
  isMultiTaskChild: integer('isMultiTaskChild', { mode: 'boolean' }).notNull().$default(() => false),
  taskIndex: integer('taskIndex'),
  metadata: jsonColumn('metadata').$default(() => ({})),

  createdAt: integer('createdAt', { mode: 'timestamp' }).notNull().$default(() => new Date()),
  updatedAt: integer('updatedAt', { mode: 'timestamp' }).notNull().$onUpdate(() => new Date()),
  createdBy: text('createdBy').notNull(),
  updatedBy: text('updatedBy').notNull()
}, (table) => [
  uniqueIndex('triage_tasks_team_notion_page_id_idx').on(table.teamId, table.notionPageId)
])