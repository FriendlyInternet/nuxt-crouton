// The clock's inbox card sync (#4234): run `runCardsSync` for the owner's team with no browser session.
// Called by onTick (clock-tick.ts) in the :00 and :30 slots. Owner = the user whose email is
// NUXT_STATUS_OWNER_EMAIL; team = the app's default team (`test1`); token = the Worker's GITHUB_TOKEN
// (the owner's read token, not the Harness App token). Shares the endpoint's 60 s throttle key.
// Never throws: every outcome is a CardsSyncRecord, which onTick writes to KV for the Clock tab.
import type { Storage } from 'unstorage'
import { THROTTLE_MS, cardsSyncThrottleKey, runCardsSync } from './cards-sync-run'

/** = nuxt.config.ts crouton.auth.teams.defaultTeamSlug */
const OWNER_TEAM_SLUG = 'test1'

/** What the last clock sync did; KV `clock:cards-sync:last`. `ok` = it finished and wrote its cards. */
export interface CardsSyncRecord {
  at: string
  ok: boolean
  throttled?: boolean
  counts?: { created: number, updated: number, stale: number, answered: number, stuck: { quiet: number, draft: number, epicSync: number } }
  /** GitHub read errors of a finished run (shown as the row's text; they don't make it fail). */
  readErrors?: string | null
  error?: string
}

export interface CardsSyncDeps {
  findOwnerTeam: (email: string) => Promise<{ teamId: string, userId: string } | null>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- useStorage's and createStorage's value types differ
  store: () => Storage<any>
  run: typeof runCardsSync
}

/** The owner's user, the default team, and the owner's membership of it — or null if any is missing. */
async function findOwnerTeam(email: string): Promise<{ teamId: string, userId: string } | null> {
  if (!email) return null
  const [{ eq }, { user, organization }, { getOrganizationMembershipDirect }] = await Promise.all([
    import('drizzle-orm'),
    import('@fyit/crouton-auth/server/database/schema/auth'),
    import('@fyit/crouton-auth/server/utils/team')
  ])
  const db = useDB()
  const [u] = await db.select().from(user).where(eq(user.email, email)).limit(1)
  if (!u) return null
  const [org] = await db.select().from(organization).where(eq(organization.slug, OWNER_TEAM_SLUG)).limit(1)
  if (!org) return null
  const membership = await getOrganizationMembershipDirect(org.id, u.id)
  return membership ? { teamId: org.id, userId: u.id } : null
}

const defaultDeps: CardsSyncDeps = {
  findOwnerTeam,
  store: () => useStorage('kv'),
  run: runCardsSync
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e))

export async function clockCardsSync(env: Record<string, unknown>, deps: CardsSyncDeps = defaultDeps): Promise<CardsSyncRecord> {
  const at = new Date().toISOString()
  try {
    const token = typeof env?.GITHUB_TOKEN === 'string' ? env.GITHUB_TOKEN : ''
    if (!token) return { at, ok: false, error: 'GITHUB_TOKEN is not configured' }
    const owner = await deps.findOwnerTeam(String(env?.NUXT_STATUS_OWNER_EMAIL ?? ''))
    if (!owner) return { at, ok: false, error: `owner or team not found (NUXT_STATUS_OWNER_EMAIL / ${OWNER_TEAM_SLUG})` }

    const store = deps.store()
    const key = cardsSyncThrottleKey(owner.teamId)
    const last = Number(await store.getItem(key)) || 0
    if (Date.now() - last < THROTTLE_MS) return { at, ok: true, throttled: true }
    await store.setItem(key, Date.now())

    const out = await deps.run({ token, teamId: owner.teamId, userId: owner.userId })
    return {
      at,
      ok: true,
      counts: { created: out.created, updated: out.updated, stale: out.stale, answered: out.answered, stuck: out.stuck },
      readErrors: out.error ?? null
    }
  } catch (e) {
    return { at, ok: false, error: message(e) }
  }
}
