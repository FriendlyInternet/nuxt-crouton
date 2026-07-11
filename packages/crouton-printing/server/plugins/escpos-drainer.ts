/**
 * In-process ESC/POS print drainer — Nitro plugin (epic #61; #328).
 *
 * On a Node target ON the venue LAN, the app can drive thermal printers
 * directly over TCP `:9100` instead of relying on the external RUT956 shell
 * spooler. This plugin runs that drainer on a poll loop, over the generic
 * `print_jobs` lifecycle (see `escpos-drainer.ts`).
 *
 * AUTO by default (#1471): runs whenever the runtime can open raw sockets — a
 * long-lived Node target (the venue Pi) — and never on Cloudflare Workers
 * (workerd: no sockets, no persistent process). The loop self-gates to
 * `local-drainer` events (#1324), so auto-on serves nothing until an event opts
 * in via the Print flow picker — the picker is the only switch. The env var is
 * an explicit override; `node:net` is imported lazily by the drainer, so even
 * loading this plugin is import-safe.
 *
 *   CROUTON_PRINTING_DRAINER           override: '1'/'true' force on · '0'/'false' force off · unset = auto
 *     (CROUTON_SALES_PRINT_DRAINER also honoured for back-compat during migration)
 *   CROUTON_PRINTING_DRAINER_EVENT     optional: only drain this event
 *   CROUTON_PRINTING_DRAINER_POLL_MS   poll interval (default 2000)
 *
 * Run EITHER this OR the HTTP spooler for a given printer set, never both.
 */
import { drainPendingEscposJobs } from '../utils/escpos-drainer'
import { canUseRawSockets, parseDrainerFlag, shouldRunDrainer } from '../utils/drainer-gate'

export default defineNitroPlugin(() => {
  const envFlag = parseDrainerFlag(process.env.CROUTON_PRINTING_DRAINER || process.env.CROUTON_SALES_PRINT_DRAINER)
  if (!shouldRunDrainer({ envFlag, canUseRawSockets: canUseRawSockets() })) return

  const eventId = process.env.CROUTON_PRINTING_DRAINER_EVENT
    || process.env.CROUTON_SALES_PRINT_DRAINER_EVENT
    || undefined
  const pollMs = Number(process.env.CROUTON_PRINTING_DRAINER_POLL_MS || process.env.CROUTON_SALES_PRINT_DRAINER_POLL_MS) || 2000

  // Skip overlapping ticks: a slow print run (a jammed printer holds the socket
  // open for the full drain window) must not stack up behind itself.
  let running = false
  const tick = async () => {
    if (running) return
    running = true
    try {
      await drainPendingEscposJobs(useDB(), { eventId })
    }
    catch (err) {
      console.error('[crouton-printing] ESC/POS drainer tick failed:', err)
    }
    finally {
      running = false
    }
  }

  // Name why it's on — helps debug an unexpected "why is this box printing?".
  const mode = envFlag === 'on' ? 'forced on' : 'auto: Node runtime'
  console.log(`🍞 crouton:printing in-process ESC/POS drainer ON [${mode}] (poll ${pollMs}ms${eventId ? `, event ${eventId}` : ', all events'})`)
  setInterval(tick, pollMs)
})
