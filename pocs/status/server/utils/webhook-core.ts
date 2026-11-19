// The GitHub webhook receiver's rules (#4309), pure so they unit-test: check the signature, keep only
// this repo's issue/PR events, and mark "something changed on GitHub" in KV. It never calls GitHub and
// never runs the card sync — the next 10-minute clock tick does that (clock-tick.ts, `isDirty`).
//
// Two timestamps, never cleared (not a flag that the clock clears): Cloudflare KV is eventually
// consistent, so a read elsewhere can be ~60 s stale. With a cleared flag a webhook could read a stale
// "set", skip its write, and the change would wait for the next :00/:30. Here both values only grow:
//   DIRTY_KEY  — when a change was last marked (only the webhook writes it, at most every REMARK_MS)
//   SYNCED_KEY — the start time of the last ok, unthrottled clock sync (only the clock writes it)
// and the clock counts a mark newer than `synced-from - DIRTY_MARGIN_MS` as dirty, so a write skipped
// on a stale read is still seen (see isDirty).
import { createHmac, timingSafeEqual } from 'node:crypto'

export const DIRTY_KEY = 'cards-sync:dirty-at'
export const SYNCED_KEY = 'cards-sync:synced-from'
/** The webhook rewrites DIRTY_KEY only when it is missing or older than this (one write per burst). */
export const REMARK_MS = 5 * 60_000
/** How stale a KV read can be (Cloudflare's cache). */
export const KV_STALE_MS = 60_000
export const DIRTY_MARGIN_MS = REMARK_MS + KV_STALE_MS

export const HANDLED_EVENTS = ['issues', 'issue_comment', 'pull_request', 'pull_request_review']

const parse = (v: string | null | undefined): number => (typeof v === 'string' ? Date.parse(v) : Number.NaN)

/** Should the webhook (re)write DIRTY_KEY? Yes when it is missing, unreadable or ≥ REMARK_MS old. */
export function shouldMark(stored: string | null | undefined, nowMs: number): boolean {
  const t = parse(stored)
  if (Number.isNaN(t)) return true
  return nowMs - t >= REMARK_MS
}

/**
 * Does the clock owe a sync? No mark → no. A mark but never a sync → yes. Otherwise yes when the mark
 * is newer than the last sync's start minus DIRTY_MARGIN_MS: a webhook skips its write only after
 * reading a mark ≥ event − REMARK_MS, and a stale read is only ever older, so an event after the sync
 * started always leaves a mark > synced-from − DIRTY_MARGIN_MS.
 */
export function isDirty(dirtyAt: string | null | undefined, syncedFrom: string | null | undefined): boolean {
  const d = parse(dirtyAt)
  if (Number.isNaN(d)) return false
  const s = parse(syncedFrom)
  if (Number.isNaN(s)) return true
  return d > s - DIRTY_MARGIN_MS
}

/** GitHub's `X-Hub-Signature-256: sha256=<hex HMAC-SHA256 of the raw body>`, compared in constant time. */
export function verifySignature(rawBody: string, header: string | undefined, secret: string): boolean {
  if (!secret || !header || !header.startsWith('sha256=')) return false
  const want = Buffer.from(`sha256=${createHmac('sha256', secret).update(rawBody, 'utf8').digest('hex')}`)
  const given = Buffer.from(header)
  if (given.length !== want.length) return false
  return timingSafeEqual(given, want)
}

export type ParsedWebhook =
  | { ok: false, status: 400 | 401 }
  | { ok: true, event: string, action: string | null, number: number | null, isPr: boolean, repo: string | null }

/** Check the signature, then read the event. Header names are read lower-case. */
export function parseWebhook(headers: Record<string, string | undefined>, rawBody: string, secret: string): ParsedWebhook {
  if (!verifySignature(rawBody, headers['x-hub-signature-256'], secret)) return { ok: false, status: 401 }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- a GitHub payload
  let body: any
  try {
    body = JSON.parse(rawBody)
  } catch {
    return { ok: false, status: 400 }
  }
  return {
    ok: true,
    event: String(headers['x-github-event'] ?? ''),
    action: typeof body?.action === 'string' ? body.action : null,
    number: body?.issue?.number ?? body?.pull_request?.number ?? null,
    isPr: !!body?.pull_request || !!body?.issue?.pull_request,
    repo: typeof body?.repository?.full_name === 'string' ? body.repository.full_name : null
  }
}

export interface WebhookStore {
  getItem: (key: string) => Promise<unknown>
  setItem: (key: string, value: string) => Promise<void>
}

/**
 * 401 bad signature (400 bad JSON) · 200 ping · 204 another repo or an unhandled event ·
 * 202 a handled event, after marking DIRTY_KEY (only when shouldMark says so).
 */
export async function handleWebhook(args: {
  headers: Record<string, string | undefined>
  rawBody: string
  secret: string
  repo: string
  store: WebhookStore
  now?: number
}): Promise<{ status: number }> {
  const { headers, rawBody, secret, repo, store, now = Date.now() } = args
  const p = parseWebhook(headers, rawBody, secret)
  if (!p.ok) return { status: p.status }
  if (p.event === 'ping') return { status: 200 }
  if (p.repo !== repo) return { status: 204 }
  if (!HANDLED_EVENTS.includes(p.event)) return { status: 204 }
  const stored = await store.getItem(DIRTY_KEY)
  if (shouldMark(typeof stored === 'string' ? stored : null, now)) await store.setItem(DIRTY_KEY, new Date(now).toISOString())
  return { status: 202 }
}
