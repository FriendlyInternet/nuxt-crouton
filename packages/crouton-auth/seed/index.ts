/**
 * crouton-auth seed provider (#84).
 *
 * Seeds the team (organization) every other provider hangs off. It creates NO
 * login: the per-app review login (created by the deploy itself, password from a
 * secret) is how people and smoke tests get in (#2357, epic #2356).
 *
 * It used to seed a staff login with a password written here — a public repo — so
 * anyone could sign in as team owner on every seeded staging. Every seed now
 * switches that old account off (password cleared, sessions ended) so the published
 * password stops working on stagings that already have it. Once every staging has
 * reseeded, that cleanup can go too.
 *
 * Runs first (no `dependsOn`); domain providers depend on `auth`.
 *
 * Pure module: references better-auth table/column names as strings, so it
 * never imports the app's generated schema and loads cleanly under jiti.
 */
import type { SeedProvider, SeedContext } from '@fyit/crouton-core/shared/seed'
import { seedId, sqlValue } from '@fyit/crouton-core/shared/seed'

/** Switch off the retired staff login: no password, no open sessions. No-op when absent. */
function disableRetiredStaffLogin(ctx: SeedContext) {
  const email = 'claude-verify@test.local'
  ctx.raw(`UPDATE account SET password = NULL WHERE id = ${sqlValue(seedId('account', email))}`)
  ctx.raw(`DELETE FROM session WHERE userId = ${sqlValue(seedId('user', email))}`)
}

export const provider: SeedProvider = {
  id: 'auth',
  async seed(ctx) {
    ctx.upsert('organization', { id: ctx.teamId }, {
      name: 'Test 1',
      slug: ctx.teamSlug,
      isDefault: false,
      personal: false,
      createdAt: ctx.now
    })

    disableRetiredStaffLogin(ctx)
  }
}

export default provider
