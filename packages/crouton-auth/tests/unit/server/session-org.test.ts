/**
 * resolveInitialOrgId — which organization a brand-new session starts in (#1703)
 *
 * WHY THIS EXISTS
 * The `session.create.after` hook this replaces could never have worked:
 * better-auth runs `create.after` through `queueAfterTransactionHook`
 * (deferred) and the old hook mutated the row with raw SQL, so the in-memory
 * session handed to `setSessionCookie` still carried
 * `activeOrganizationId: null` — and better-auth's cookie cache
 * (server/lib/auth.ts:345-348, maxAge 300) then served that null for up to five
 * minutes. The correct hook is `session.create.before`, whose returned
 * `{ data }` is merged into the record actually created.
 *
 * The resolver is extracted into its own module so it can be tested against a
 * plain `{ all, run }` fake, sidestepping the drizzle/better-auth mocking wall
 * that `server/lib/auth.ts` imposes.
 *
 * Resolution order: personal org (when autoCreateOnSignup) → default-team org
 * (when defaultTeamSlug) → FIRST MEMBERSHIP (new — this is what fixes kassa,
 * velo and triage, none of which set a `teams` config) → null.
 */
import { describe, it, expect, vi } from 'vitest'

import { resolveInitialOrgId } from '../../../server/lib/session-org'

/** Rough text of a drizzle `sql` template, for structural assertions. */
function sqlText(query: unknown): string {
  return JSON.stringify(query ?? '').toLowerCase()
}

/** Fake drizzle db that answers `all()` from a queue of canned result sets. */
function fakeDb(results: unknown[][]) {
  const queries: unknown[] = []
  const queue = [...results]
  return {
    queries,
    db: {
      all: vi.fn(async (query: unknown) => {
        queries.push(query)
        return queue.shift() ?? []
      }),
      run: vi.fn(async () => undefined)
    } as never
  }
}

describe('resolveInitialOrgId (#1703)', () => {
  it('returns the personal org when autoCreateOnSignup is enabled', async () => {
    const { db } = fakeDb([[{ id: 'org-personal' }]])

    const orgId = await resolveInitialOrgId(db, 'user-1', { autoCreateOnSignup: true })

    expect(orgId).toBe('org-personal')
  })

  it('returns the default-team org when defaultTeamSlug is set', async () => {
    const { db } = fakeDb([[{ id: 'org-default', name: 'Acme', slug: 'acme' }]])

    const orgId = await resolveInitialOrgId(db, 'user-1', { defaultTeamSlug: 'acme' })

    expect(orgId).toBe('org-default')
  })

  it('falls back to the first membership when no teams config is set', async () => {
    // The kassa / velo / triage case: no `teams` block at all. Today this
    // returns null, which is exactly why a fresh session starts org-less and
    // the client has to repair it.
    const { db } = fakeDb([[{ organizationId: 'org-1' }]])

    const orgId = await resolveInitialOrgId(db, 'user-1', {})

    expect(orgId).toBe('org-1')
  })

  it('returns null when the user has no memberships at all', async () => {
    const { db } = fakeDb([[]])

    const orgId = await resolveInitialOrgId(db, 'user-1', {})

    expect(orgId).toBeNull()
  })

  it('orders memberships deterministically so the choice is stable across logins', async () => {
    const { db, queries } = fakeDb([[
      { organizationId: 'org-a' },
      { organizationId: 'org-b' }
    ]])

    const orgId = await resolveInitialOrgId(db, 'user-1', {})

    expect(orgId).toBe('org-a')
    // A user in two teams must not land somewhere different each login.
    expect(sqlText(queries.at(-1))).toContain('order by')
  })
})
