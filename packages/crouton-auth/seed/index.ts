/**
 * crouton-auth seed provider (#84).
 *
 * Seeds the team (organization) every other provider hangs off. It creates NO
 * login: people and smoke tests get in through the per-app review login, which
 * the deploy creates itself (password from a secret, sign-in link emailed to the
 * owner). Never write a password into a seed — this repo is public (#2356).
 *
 * Runs first (no `dependsOn`); domain providers depend on `auth`.
 *
 * Pure module: references better-auth table/column names as strings, so it
 * never imports the app's generated schema and loads cleanly under jiti.
 */
import type { SeedProvider } from '@fyit/crouton-core/shared/seed'

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
  }
}

export default provider
