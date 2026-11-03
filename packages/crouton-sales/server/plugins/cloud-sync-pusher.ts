/**
 * Cloud-sync push loop — Nitro plugin (#177, epic #175).
 *
 * On the venue Pi (a Node target), drains the `sales_sync_outbox` (#176) to the
 * cloud ingest endpoint (#178) on a poll loop. Mirrors the escpos-drainer plugin:
 * OFF by default and on every Cloudflare deploy, starting only when the Pi opts
 * in — so existing deploys are unchanged and Workers (no long-lived process,
 * outbound to itself) never run it.
 *
 *   CROUTON_SALES_CLOUD_SYNC           '1' | 'true' to enable (same flag as capture)
 *   CROUTON_SALES_CLOUD_SYNC_URL       required: the cloud ingest endpoint URL
 *   NUXT_CROUTON_SALES_CLOUD_SYNC_SECRET  shared secret (x-sync-key)
 *   CROUTON_SALES_CLOUD_SYNC_POLL_MS   base poll interval (default 3000)
 *   CROUTON_SALES_CLOUD_SYNC_BATCH     rows per batch (default 100)
 *   CROUTON_SALES_CLOUD_SYNC_HEARTBEAT_MS  idle heartbeat interval (default 30000)
 *
 * Online-only: when the push fails (offline / endpoint down) it backs off
 * exponentially (capped) and resumes on reconnect; a full batch drains again
 * immediately so a burst empties within seconds. Self-chained setTimeout (not
 * setInterval) means ticks never overlap.
 *
 * Pull (#815): after each push cycle the till asks the cloud for config changes
 *   since its saved cursor and applies them with the conflict rule
 *   (CROUTON_SALES_CLOUD_SYNC_PULL_URL overrides the derived `/pull` URL).
 *
 * Idle heartbeat (#179): when nothing is pending we still ping the ingest with
 * an empty batch every HEARTBEAT_MS so the cloud's freshness clock keeps
 * advancing — letting the online dashboard tell "online but quiet" from
 * "offline". A real push already refreshes that clock, so the ping only fires
 * after a stretch with no data to send.
 */
import { pingHeartbeat, pushPendingOutbox } from '../utils/cloud-sync-pusher'
import { pullConfigChanges } from '../utils/sync-pull'

const MAX_BACKOFF_MS = 60000

export default defineNitroPlugin(() => {
  const flag = process.env.CROUTON_SALES_CLOUD_SYNC
  if (flag !== '1' && flag !== 'true') return

  const url = process.env.CROUTON_SALES_CLOUD_SYNC_URL
  if (!url) {
    console.warn('🍞 crouton:sales cloud sync ON but CROUTON_SALES_CLOUD_SYNC_URL unset — pusher idle')
    return
  }

  const basePollMs = Number(process.env.CROUTON_SALES_CLOUD_SYNC_POLL_MS) || 3000
  const batchSize = Number(process.env.CROUTON_SALES_CLOUD_SYNC_BATCH) || 100
  const heartbeatMs = Number(process.env.CROUTON_SALES_CLOUD_SYNC_HEARTBEAT_MS) || 30000

  let backoff = 0
  // Last time we successfully reached the cloud (push or ping). Drives the idle
  // ping cadence so we don't ping on every quiet tick.
  let lastContactAt = 0
  const schedule = (ms: number) => setTimeout(tick, ms)

  const tick = async () => {
    try {
      const res = await pushPendingOutbox(useDB(), { url, batchSize })
      // Nothing to send for a while → keep the cloud's freshness clock alive.
      if (res.claimed === 0 && Date.now() - lastContactAt >= heartbeatMs) {
        await pingHeartbeat({ url })
      }
      // Then pull what changed online (#815). A pull failure backs off like a push failure.
      await pullConfigChanges(useDB(), { url })
      lastContactAt = Date.now()
      backoff = 0 // success clears any backoff
      // Drain bursts fast: a full batch likely means more is pending.
      schedule(res.claimed >= batchSize ? 50 : basePollMs)
    }
    catch (err) {
      backoff = backoff ? Math.min(backoff * 2, MAX_BACKOFF_MS) : basePollMs
      console.error(`[crouton-sales] cloud sync push failed (retry in ${backoff}ms):`, (err as { message?: string })?.message || err)
      schedule(backoff)
    }
  }

  console.log(`🍞 crouton:sales cloud sync pusher ON (poll ${basePollMs}ms, heartbeat ${heartbeatMs}ms → ${url})`)
  schedule(basePollMs)
})
