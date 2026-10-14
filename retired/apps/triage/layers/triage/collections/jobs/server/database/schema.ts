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

export const triageJobs = sqliteTable('triage_jobs', {
  id: text('id').primaryKey().$default(() => nanoid()),

  teamId: text('teamId').notNull(),
  owner: text('owner').notNull(),

  order: integer('order').notNull().$default(() => 0),
  discussionId: text('discussionId').notNull(),
  flowInputId: text('flowInputId').notNull(),
  status: text('status').notNull(),
  stage: text('stage'),
  attempts: integer('attempts').notNull(),
  maxAttempts: integer('maxAttempts').notNull(),
  error: text('error'),
  errorStack: text('errorStack'),
  startedAt: integer('startedAt', { mode: 'timestamp' }).$default(() => new Date()),
  completedAt: integer('completedAt', { mode: 'timestamp' }).$default(() => new Date()),
  processingTime: integer('processingTime'),
  taskIds: jsonColumn('taskIds').$default(() => (null)),
  metadata: jsonColumn('metadata').$default(() => ({})),

  createdAt: integer('createdAt', { mode: 'timestamp' }).notNull().$default(() => new Date()),
  updatedAt: integer('updatedAt', { mode: 'timestamp' }).notNull().$onUpdate(() => new Date()),
  createdBy: text('createdBy').notNull(),
  updatedBy: text('updatedBy').notNull()
})