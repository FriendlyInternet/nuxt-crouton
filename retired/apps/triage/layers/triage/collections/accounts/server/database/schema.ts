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

export const triageAccounts = sqliteTable('triage_accounts', {
  id: text('id').primaryKey().$default(() => nanoid()),

  teamId: text('teamId').notNull(),
  owner: text('owner').notNull(),

  order: integer('order').notNull().$default(() => 0),
  provider: text('provider').notNull(),
  label: text('label').notNull(),
  providerAccountId: text('providerAccountId').notNull(),
  accessToken: text('accessToken').notNull(),
  accessTokenHint: text('accessTokenHint'),
  refreshToken: text('refreshToken'),
  tokenExpiresAt: integer('tokenExpiresAt', { mode: 'timestamp' }).$default(() => new Date()),
  scopes: text('scopes'),
  providerMetadata: jsonColumn('providerMetadata').$default(() => ({})),
  status: text('status').notNull(),
  lastVerifiedAt: integer('lastVerifiedAt', { mode: 'timestamp' }).$default(() => new Date()),

  createdAt: integer('createdAt', { mode: 'timestamp' }).notNull().$default(() => new Date()),
  updatedAt: integer('updatedAt', { mode: 'timestamp' }).notNull().$onUpdate(() => new Date()),
  createdBy: text('createdBy').notNull(),
  updatedBy: text('updatedBy').notNull()
})