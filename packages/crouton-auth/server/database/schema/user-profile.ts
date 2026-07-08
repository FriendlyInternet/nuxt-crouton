/**
 * User Profile Schema
 *
 * Stores per-user preferences (locale, timezone, etc.) in a separate table
 * to keep Better Auth's `user` table untouched. 1:1 relation with user,
 * lazy-created on first write (PATCH).
 */
import { sqliteTable, text, integer, index } from 'drizzle-orm/sqlite-core'
import { relations } from 'drizzle-orm'
import { user } from './user'

export const userProfile = sqliteTable('user_profile', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  userId: text('userId').notNull().unique()
    .references(() => user.id, { onDelete: 'cascade' }),
  /** User's preferred locale (null = use site/browser default) */
  locale: text('locale'),
  updatedAt: integer('updatedAt', { mode: 'timestamp' })
    .notNull().$default(() => new Date()).$onUpdate(() => new Date()),
}, table => [
  index('user_profile_user_idx').on(table.userId),
])

export const userProfileRelations = relations(userProfile, ({ one }) => ({
  user: one(user, {
    fields: [userProfile.userId],
    references: [user.id],
  }),
}))

export type UserProfileRecord = typeof userProfile.$inferSelect
export type NewUserProfileRecord = typeof userProfile.$inferInsert