/**
 * crouton-auth seed provider (#84).
 *
 * Seeds the team (organization) every other provider hangs off, and — only
 * when `--with-staff` is passed — a staff login so the "Team member? Log in"
 * door can be exercised end to end.
 *
 * The staff password comes ONLY from the `CROUTON_SEED_STAFF_PASSWORD` env var
 * (a CI secret on staging, your own value locally). This repo is public, so a
 * password written here is a working owner login on every seeded staging (#2357).
 * Without the env var no staff login is created — and an already-seeded staff
 * account has its password cleared, so an old published password stops working.
 *
 * Runs first (no `dependsOn`); domain providers depend on `auth`.
 *
 * Pure module: references better-auth table/column names as strings, so it
 * never imports the app's generated schema and loads cleanly under jiti.
 */
import type { SeedProvider, SeedContext } from '@fyit/crouton-core/shared/seed'
import { seedId, sqlValue } from '@fyit/crouton-core/shared/seed'

const STAFF_PASSWORD_ENV = 'CROUTON_SEED_STAFF_PASSWORD'

/** The staff account used by verification flows. Its password is never stored here. */
const STAFF = {
  email: 'claude-verify@test.local',
  name: 'Claude Verify'
}

/** The staff password from the environment, or null when unset/blank. Read at seed time. */
function staffPassword(): string | null {
  const value = process.env[STAFF_PASSWORD_ENV]?.trim()
  return value ? value : null
}

async function seedStaff(ctx: SeedContext) {
  const userId = seedId('user', STAFF.email)
  const accountId = seedId('account', STAFF.email)

  const password = staffPassword()
  if (!password) {
    console.warn(`[crouton-auth seed] --with-staff given but ${STAFF_PASSWORD_ENV} is not set — no staff login seeded (#2357).`)
    // Clear the password of a staff account seeded earlier (no-op when absent), so a
    // previously published password stops working instead of lingering on staging.
    ctx.raw(`UPDATE account SET password = NULL WHERE id = ${sqlValue(accountId)}`)
    return
  }

  // better-auth stores a scrypt envelope in account.password — hash with its
  // own helper so the seeded credential verifies on login.
  const { hashPassword } = await import('better-auth/crypto')
  const passwordHash = await hashPassword(password)
  const memberId = seedId('member', ctx.teamSlug, STAFF.email)

  ctx.upsert('user', { id: userId }, {
    name: STAFF.name,
    email: STAFF.email,
    emailVerified: true,
    role: 'user',
    createdAt: ctx.now,
    updatedAt: ctx.now
  })

  // Credential account (providerId 'credential', accountId === userId is the
  // better-auth convention for email/password).
  ctx.upsert('account', { id: accountId }, {
    userId,
    accountId: userId,
    providerId: 'credential',
    password: passwordHash,
    createdAt: ctx.now,
    updatedAt: ctx.now
  })

  // Owner membership of the seeded team.
  ctx.upsert('member', { id: memberId }, {
    userId,
    organizationId: ctx.teamId,
    role: 'owner',
    createdAt: ctx.now
  })
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

    if (ctx.withStaff) {
      await seedStaff(ctx)
    }
  }
}

export default provider
