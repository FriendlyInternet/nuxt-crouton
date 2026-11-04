> 🗄️ **Archived 2026-11-04 (#3352) — done:** shipped as the user-profile locale in crouton-auth. Historical record, not current guidance.

# User Locale Persistence

## Summary

Add a `user_profile` table to `crouton-auth` to store per-user preferences (starting with `locale`), keeping Better Auth's `user` table untouched. The language switcher should persist the choice to the database, and it should be auto-applied on login. This also enables server-side locale lookup for email sending.

## Context

Currently the language switcher (`crouton-i18n`) only calls `setLocale()` in-memory — nothing persists. When a user refreshes or switches devices, the locale resets. For the bookings system, we also need server-side locale to send emails in the right language.

Storing locale on the user level (not `member`) is intentional — a user's language preference is personal, not team-specific. The `UserProfile` type in `types/auth.ts` already defines `locale` and `timezone` fields but has no database backing — this briefing adds that persistence layer.

## Architecture Decision: `user_profile` Table

Better Auth owns the `user` table. Adding custom columns to it works but mixes auth concerns with app preferences and risks conflicts on library upgrades. Instead, we create a separate `user_profile` table with a 1:1 relation to `user`:

- **Clean separation** — Better Auth owns `user`, we own `user_profile`
- **Extensible** — future fields (timezone, notification prefs, dashboard layout) go here
- **CASCADE delete** — cleanup is automatic when a user is deleted
- **Lazy-create** — profile row is created on first write (PATCH), not on user creation

## Files to Change

### 1. Database Schema — NEW FILE in `crouton-auth`

**File:** `packages/crouton-auth/server/database/schema/user-profile.ts`

```typescript
import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core'
import { nanoid } from 'nanoid'
import { user } from './auth'

export const userProfile = sqliteTable('user_profile', {
  id: text('id').primaryKey().$default(() => nanoid()),
  userId: text('userId').notNull().unique()
    .references(() => user.id, { onDelete: 'cascade' }),
  locale: text('locale'), // null = use site/browser default
  updatedAt: integer('updatedAt', { mode: 'timestamp' })
    .notNull().$default(() => new Date()).$onUpdate(() => new Date()),
})
```

Re-export from the schema barrel file (`packages/crouton-auth/server/database/schema/index.ts`).

### 2. Relations

**File:** `packages/crouton-auth/server/database/schema/user-profile.ts`

```typescript
import { relations } from 'drizzle-orm'

export const userProfileRelations = relations(userProfile, ({ one }) => ({
  user: one(user, {
    fields: [userProfile.userId],
    references: [user.id]
  })
}))
```

Also add the inverse relation on `user` in `auth.ts`:

```typescript
// Add to existing userRelations
profile: one(userProfile, {
  fields: [user.id],
  references: [userProfile.userId]
})
```

### 3. Types — `crouton-auth`

**File:** `packages/crouton-auth/types/auth.ts`

Add:

```typescript
export type UserProfileRecord = typeof userProfile.$inferSelect
export type NewUserProfileRecord = typeof userProfile.$inferInsert
```

The existing `UserProfile` interface already has `locale` and `timezone` — no changes needed there.

### 4. Migration

Run `npx nuxt db generate` in any app that uses crouton-auth to generate the CREATE TABLE migration for `user_profile`.

### 5. API Endpoint — NEW FILE

**File:** `packages/crouton-auth/server/api/users/me/profile.patch.ts`

- Accepts partial profile fields: `{ locale?: string, timezone?: string, ... }`
- Auth check: user can only update their own profile (derived from session)
- Validates `locale` against the app's supported locales (from crouton-i18n config), not arbitrary ISO codes — setting an unsupported locale is meaningless
- Upserts `user_profile` row using true SQL upsert (`INSERT ... ON CONFLICT DO UPDATE`), not check-then-insert — concurrent requests must not race
- Generic endpoint avoids needing per-field routes (`locale.patch.ts`, `timezone.patch.ts`, etc.)

### 6. Server Utility — `crouton-auth`

**File:** `packages/crouton-auth/server/utils/user-profile.ts`

Shared helper for upserting and reading user profiles:

```typescript
export async function getUserProfile(userId: string) {
  // SELECT from user_profile WHERE userId = ?
}

export async function upsertUserProfile(userId: string, data: Partial<NewUserProfileRecord>) {
  // INSERT ... ON CONFLICT(userId) DO UPDATE
}
```

### 7. Composable — `crouton-auth`

**File:** `packages/crouton-auth/app/composables/useSession.ts`

Add to existing composable:

```typescript
async function updateUserProfile(data: Partial<NewUserProfileRecord>) {
  // PATCH /api/users/me/profile
  // Update local user profile state
}

// Convenience shorthand
async function updateUserLocale(locale: string) {
  return updateUserProfile({ locale })
}
```

Expose `userProfile` (or at minimum `userLocale`) as a computed from the current user's profile.

### 8. Language Switcher — `crouton-i18n`

**Files:**
- `packages/crouton-i18n/app/components/LanguageSwitcher.vue`
- `packages/crouton-i18n/app/components/LanguageSwitcherIsland.vue`

After `setLocale()`, also call `updateUserLocale()` if user is authenticated. Non-authenticated users keep in-memory-only behavior.

### 9. Auto-apply on Login

**File:** `packages/crouton-auth/app/composables/useSession.ts`

When loading the user session, fetch `user_profile` as a **separate query after session loads** (not a JOIN on Better Auth's session query). This keeps auth code untouched. If `profile.locale` is set, call `setLocale(profile.locale)` to sync the UI.

No team-switch hook needed — locale follows the user, not the team.

## Constraints

- Better Auth's `user` table is read-only for us — all custom fields go in `user_profile`
- User table is in `crouton-auth`, language switcher is in `crouton-i18n` — use the composable from `crouton-auth` as the bridge
- i18n config: `strategy: 'no_prefix'`, `detectBrowserLanguage: false`
- Public pages use URL-driven locale (`/[team]/[locale]/[slug]`), admin pages use user preference
- Use `hub: { db: 'sqlite' }` — NEVER `hub: { database: true }`
- Profile rows are lazy-created on first PATCH, not eagerly on user creation
- Profile fetch is a separate query after session loads — never JOIN on Better Auth's session query
- Upsert must be true SQL upsert (`ON CONFLICT DO UPDATE`), not check-then-insert — prevents race conditions on concurrent requests
- Locale validation is against the app's supported locales, not arbitrary ISO codes

## Future Extensions

The `user_profile` table is designed to grow. Likely future columns:
- `timezone` — for scheduling and date display
- `notificationPrefs` — JSON column for email/push preferences
- `dashboardLayout` — JSON column for UI customization

## Testing

- Switch language → refresh → should persist
- Log in on new device → should apply saved locale
- Non-authenticated user → should still work (in-memory only)
- Email sending → should use user's locale for template selection
- New user with no locale set → falls back to site default
- User deletion → profile row should cascade-delete
- First locale save → should create profile row (upsert)
- Concurrent locale saves → should not fail (upsert handles race)
- Setting unsupported locale → should be rejected by validation