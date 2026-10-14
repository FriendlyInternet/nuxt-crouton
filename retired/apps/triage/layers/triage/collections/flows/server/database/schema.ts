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

export const triageFlows = sqliteTable('triage_flows', {
  id: text('id').primaryKey().$default(() => nanoid()),

  teamId: text('teamId').notNull(),
  owner: text('owner').notNull(),

  order: integer('order').notNull().$default(() => 0),
  name: text('name').notNull(),
  description: text('description'),
  availableDomains: jsonColumn('availableDomains').$default(() => (null)),
  aiEnabled: integer('aiEnabled', { mode: 'boolean' }).notNull().$default(() => true),
  anthropicApiKey: text('anthropicApiKey'),
  anthropicApiKeyHint: text('anthropicApiKeyHint'),
  aiSummaryPrompt: text('aiSummaryPrompt'),
  aiTaskPrompt: text('aiTaskPrompt'),
  replyPersonality: text('replyPersonality'),
  personalityIcon: text('personalityIcon'),
  active: integer('active', { mode: 'boolean' }).notNull().$default(() => true),
  onboardingComplete: integer('onboardingComplete', { mode: 'boolean' }).notNull().$default(() => false),

  createdAt: integer('createdAt', { mode: 'timestamp' }).notNull().$default(() => new Date()),
  updatedAt: integer('updatedAt', { mode: 'timestamp' }).notNull().$onUpdate(() => new Date()),
  createdBy: text('createdBy').notNull(),
  updatedBy: text('updatedBy').notNull()
})