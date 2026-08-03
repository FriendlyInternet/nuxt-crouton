/**
 * User table - Core user identity
 *
 * Lives in its own module (not auth.ts) so satellite tables like
 * user-profile can reference it without importing auth.ts — auth.ts
 * imports user-profile for relations, which would otherwise be a cycle.
 * auth.ts re-exports everything here, so consumers keep importing from
 * the auth schema as before.
 */
import { sqliteTable, text, integer, index } from 'drizzle-orm/sqlite-core'

/**
 * Stores basic user information and profile data.
 * Extended with stripeCustomerId for billing support.
 */
export const user = sqliteTable('user', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  emailVerified: integer('emailVerified', { mode: 'boolean' }).notNull().default(false),
  image: text('image'),
  createdAt: integer('createdAt', { mode: 'timestamp' }).notNull().$default(() => new Date()),
  updatedAt: integer('updatedAt', { mode: 'timestamp' }).notNull().$onUpdate(() => new Date()),
  // Stripe extension
  stripeCustomerId: text('stripeCustomerId'),
  // Admin extension (crouton-admin package)
  /** Whether this user has super admin privileges */
  superAdmin: integer('superAdmin', { mode: 'boolean' }).notNull().default(false),
  /** Whether this user is banned from the platform */
  banned: integer('banned', { mode: 'boolean' }).notNull().default(false),
  /** Reason for the ban (shown to user and admin) */
  bannedReason: text('bannedReason'),
  /** When the ban expires (null = permanent) */
  bannedUntil: integer('bannedUntil', { mode: 'timestamp' }),
  // Better Auth 1.5+ user role (admin plugin)
  role: text('role').default('user')
}, table => [
  index('user_email_idx').on(table.email),
  index('user_stripe_customer_idx').on(table.stripeCustomerId),
  index('user_super_admin_idx').on(table.superAdmin),
  index('user_banned_idx').on(table.banned)
])

export type User = typeof user.$inferSelect
export type NewUser = typeof user.$inferInsert
