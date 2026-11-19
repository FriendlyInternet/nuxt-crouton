// One clock tick (#4133): start each due workflow with `workflow_dispatch`, as the Harness App.
// In the :00 and :30 slots it also runs the inbox card sync (#4234, cards-sync-clock.ts) with the
// owner's GITHUB_TOKEN — started first and independent of the dispatches (no job due, a failed
// App-token mint), awaited before the tick returns — and writes its record to KV
// `clock:cards-sync:last` for the Clock tab. Called by server/plugins/clock.ts on the Worker's
// `scheduled()` event. Never throws.
import type { Storage } from 'unstorage'
import type { CardsSyncRecord } from './cards-sync-clock'
import { dueJobs } from './clock-jobs'
import { mintInstallationToken } from './github-app'
import { ghPost } from './github-core'

const REPO = 'FriendlyInternet/nuxt-crouton'
export const CARDS_SYNC_KEY = 'clock:cards-sync:last'

export interface TickResult {
  workflow: string
  status: number | null
}

/** The card sync a tick runs, and where it records the outcome (injectable for tests). */
export interface TickSync {
  run: (env: Record<string, unknown>) => Promise<CardsSyncRecord>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- useStorage's and createStorage's value types differ
  store: () => Storage<any>
}

// Resolved lazily: a tick that runs no sync never loads the database code or touches useStorage.
const defaultTickSync: TickSync = {
  run: async env => (await import('./cards-sync-clock')).clockCardsSync(env),
  store: () => useStorage('kv')
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e))

/** The :00 and :30 slots (UTC), i.e. minutes [0, 10) and [30, 40). */
export const isCardsSyncSlot = (t: Date) => t.getUTCMinutes() % 30 < 10

function startCardsSync(env: Record<string, unknown>, sync: TickSync): Promise<void> {
  const at = new Date().toISOString()
  return Promise.resolve()
    .then(() => sync.run(env))
    .catch((e): CardsSyncRecord => ({ at, ok: false, error: message(e) }))
    .then(async (rec) => {
      console.log(`clock: cards-sync → ${rec.ok ? 'ok' : 'failed'}${rec.throttled ? ' (throttled)' : ''}${rec.error ? ` ${rec.error}` : ''}`)
      try {
        await sync.store().setItem(CARDS_SYNC_KEY, rec)
      } catch (e) {
        console.log(`clock: cards-sync record → ${message(e)}`)
      }
    })
}

export async function onTick(
  scheduledTime: number,
  env: Record<string, unknown>,
  fetchFn: typeof fetch = fetch,
  sync: TickSync = defaultTickSync
): Promise<TickResult[]> {
  const results: TickResult[] = []
  let syncP: Promise<void> | null = null
  try {
    if (env?.CLOCK_ENABLED !== '1') return results
    if (isCardsSyncSlot(new Date(scheduledTime))) syncP = startCardsSync(env, sync)
    const due = dueJobs(new Date(scheduledTime))
    if (!due.length) return results
    let token: string
    try {
      token = await mintInstallationToken({
        appId: String(env.HARNESS_APP_ID ?? ''),
        privateKey: String(env.HARNESS_APP_PRIVATE_KEY ?? ''),
        installationId: String(env.HARNESS_APP_INSTALLATION_ID ?? '')
      }, 'crouton-status', fetchFn)
    } catch (e) {
      console.log(`clock: token → ${message(e)}`)
      return results
    }
    for (const job of due) {
      const r = await ghPost(`/repos/${REPO}/actions/workflows/${job.workflow}/dispatches`, token, { ref: 'main', inputs: { clock: 'true' } }, fetchFn)
      console.log(`clock: ${job.workflow} → ${r.status ?? r.error}`)
      results.push({ workflow: job.workflow, status: r.status })
    }
  } catch (e) {
    console.log(`clock: tick failed → ${message(e)}`)
  } finally {
    if (syncP) await syncP
  }
  return results
}
