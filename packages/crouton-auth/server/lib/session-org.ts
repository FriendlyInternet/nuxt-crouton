/**
 * Initial active organization for a newly created session
 *
 * Extracted from `auth.ts` so it can be unit-tested against a plain
 * `{ all, run }` fake, without standing up better-auth + drizzle.
 *
 * ## Why this is a `session.create.BEFORE` concern (#1703)
 *
 * The previous implementation lived in `databaseHooks.session.create.after` and
 * wrote the org with a raw `UPDATE`. That can never work: better-auth runs
 * `create.after` through `queueAfterTransactionHook` (deferred), so the
 * in-memory session handed to `setSessionCookie` still carries
 * `activeOrganizationId: null` — and with the cookie cache enabled
 * (`buildSessionConfig`, maxAge 300) that stale null is then served for up to
 * five minutes.
 *
 * `create.before` is the correct hook: whatever it returns as `{ data }` is
 * merged into the record that is actually created, so it lands in the session
 * row *and* in the cookie.
 *
 * The client used to paper over this at runtime — `useSession`'s
 * `$sessionSignal` handler would notice the null org and call `setActive`,
 * which re-emits `$sessionSignal` and re-enters itself. That re-entrancy is
 * what stranded kassa logins on an infinite spinner.
 */
import { sql } from 'drizzle-orm'
import type { DrizzleD1Database } from 'drizzle-orm/d1'
import type { TeamsConfig } from '../../types/config'

/**
 * Look up an organization by slug.
 *
 * Lives here rather than in `auth.ts` so there is exactly one copy of this
 * query: `auth.ts` already imports this module, so the dependency runs
 * leaf-ward and importing it back the other way would be circular.
 */
export async function getOrgBySlug(
  db: DrizzleD1Database<Record<string, unknown>>,
  slug: string
): Promise<{ id: string, name: string, slug: string } | null> {
  const result = await db.all(sql`
    SELECT id, name, slug FROM organization WHERE slug = ${slug}
  `)

  return (result[0] as { id: string, name: string, slug: string } | undefined) ?? null
}

/**
 * Resolve which organization a brand-new session should start in.
 *
 * Order of preference:
 * 1. The user's personal workspace — only when `autoCreateOnSignup` is on.
 * 2. The configured default team — only when `defaultTeamSlug` is set.
 * 3. **The user's first membership.** This is the case that matters for apps
 *    with no `teams` config at all (kassa, velo, triage): they have real
 *    memberships, they just never told crouton which one to prefer. Ordered by
 *    `member.createdAt` then `organization.id` so a user in several teams lands
 *    in the same place on every login instead of wherever SQLite felt like.
 * 4. `null` — a genuinely team-less account. The UI is responsible for saying
 *    so; it must not spin.
 *
 * Never throws: a resolution failure must not take down sign-in. The caller
 * treats `null` as "leave `activeOrganizationId` alone".
 */
export async function resolveInitialOrgId(
  db: DrizzleD1Database<Record<string, unknown>>,
  userId: string,
  teams: TeamsConfig = {}
): Promise<string | null> {
  if (teams.autoCreateOnSignup) {
    const personal = await db.all(sql`
      SELECT id FROM organization
      WHERE personal = 1 AND ownerId = ${userId}
      LIMIT 1
    `)
    const id = (personal[0] as { id?: string } | undefined)?.id
    if (id) return id
  }

  if (teams.defaultTeamSlug) {
    const defaultOrg = await getOrgBySlug(db, teams.defaultTeamSlug)
    if (defaultOrg) return defaultOrg.id
  }

  // Deterministic tiebreak — see (3) above.
  const memberships = await db.all(sql`
    SELECT m.organizationId AS organizationId
    FROM member m
    JOIN organization o ON o.id = m.organizationId
    WHERE m.userId = ${userId}
    ORDER BY m.createdAt ASC, o.id ASC
    LIMIT 1
  `)

  return (memberships[0] as { organizationId?: string } | undefined)?.organizationId ?? null
}
