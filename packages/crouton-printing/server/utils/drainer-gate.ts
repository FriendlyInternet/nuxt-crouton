/**
 * Start-decision for the in-process ESC/POS drainer (#1471).
 *
 * The drainer prints straight to LAN printers over raw TCP — only possible on a
 * long-lived Node runtime (a venue Pi / mini-PC), never on Cloudflare Workers
 * (no sockets, no persistent process). It USED to require an explicit
 * `CROUTON_PRINTING_DRAINER=1`; that read like a per-event step in the setup
 * guide and is redundant on the one runtime where it can run.
 *
 * Now it's **auto**: run whenever the runtime can open raw sockets. The loop
 * already self-gates to `local-drainer` events (#1324), so auto-on serves
 * NOTHING until an event opts in via the Print flow picker — the picker becomes
 * the only switch. The env var stays as an explicit override: force on
 * (back-compat) or force off (a deliberate Node deploy that must not print).
 */
import { isNode, isWorkerd } from 'std-env'

export type DrainerEnvFlag = 'on' | 'off' | 'unset'

/**
 * Parse the drainer env override. `'1'`/`'true'` → on, `'0'`/`'false'` → off,
 * anything else (incl. undefined) → unset (fall through to auto-detection).
 */
export function parseDrainerFlag(raw: string | undefined): DrainerEnvFlag {
  const v = raw?.trim().toLowerCase()
  if (v === '1' || v === 'true') return 'on'
  if (v === '0' || v === 'false') return 'off'
  return 'unset'
}

/**
 * Whether the drainer loop should run. Pure + exhaustively testable: the env
 * override wins in both directions; unset defers to raw-socket capability.
 */
export function shouldRunDrainer(opts: { envFlag: DrainerEnvFlag, canUseRawSockets: boolean }): boolean {
  if (opts.envFlag === 'on') return true
  if (opts.envFlag === 'off') return false
  return opts.canUseRawSockets
}

/**
 * Runtime probe: a long-lived Node server can open raw TCP sockets; the
 * Cloudflare Workers runtime (workerd) cannot. `std-env` (already in the tree
 * via Nitro) is the idiomatic detector — no hand-rolled `navigator.userAgent`
 * sniffing. Kept out of the pure fn above so the decision stays unit-testable.
 */
export function canUseRawSockets(): boolean {
  return isNode && !isWorkerd
}
