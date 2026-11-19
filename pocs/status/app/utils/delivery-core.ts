// Pure core for the delivery card ("try it"): the Open-and-sign-in link and the one-tap result.
// The result goes through POST /api/cards/[cardId]/answer only — Works posts `ok` on the epic,
// Not ok posts `not ok: <note>`. No refs, no $fetch, no auto-imports, so it unit-tests.
import type { InboxCard, SendResult } from './inbox-core'
import { loginHrefFor } from './walk'

export type DeliveryVerdict = 'works' | 'not-ok'

const strings = (v: unknown): string[] => Array.isArray(v) ? v.filter((s): s is string => typeof s === 'string') : []

/**
 * The "Open and sign in" link for a delivery card — the same test-login route the To-test buttons
 * use (`/api/status/login/<app>`). No `payload.app` → null (the card links to the epic instead).
 */
export function deliveryOpenLink(card: Pick<InboxCard, 'payload' | 'sourceNumber' | 'title'>): string | null {
  const app = card.payload?.app
  if (typeof app !== 'string' || !app) return null
  const to = typeof card.payload?.to === 'string' ? card.payload.to : null
  return loginHrefFor({ app, number: card.sourceNumber, title: card.title, steps: strings(card.payload?.steps), to })
}

/** Error text for a result that must not be sent, or null when it is fine. */
export function validateDelivery(verdict: unknown, note: unknown): string | null {
  if (verdict !== 'works' && verdict !== 'not-ok') return 'Pick Works or Not ok.'
  if (verdict === 'not-ok' && !(typeof note === 'string' && note.trim())) return 'Add a short note first.'
  return null
}

/**
 * Send a delivery result to the card answer endpoint. Invalid → refused before any call.
 * Returns the HTTP status and the server's error text (statusMessage) on a non-2xx or a throw.
 */
export async function sendDelivery(args: {
  cardId: string
  verdict: DeliveryVerdict
  note?: string
  fetchImpl?: typeof fetch
}): Promise<SendResult> {
  const { cardId, verdict, note = '', fetchImpl = fetch } = args
  const invalid = validateDelivery(verdict, note)
  if (invalid) return { status: 400, error: invalid }
  try {
    const res = await fetchImpl(`/api/cards/${encodeURIComponent(cardId)}/answer`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind: 'delivery', verdict, note: note.trim() })
    })
    if (res.ok) return { status: res.status, error: null }
    const data = await res.json().catch(() => null) as { statusMessage?: string, message?: string } | null
    return { status: res.status, error: data?.statusMessage || data?.message || 'Could not send.' }
  } catch (e) {
    return { status: 500, error: (e instanceof Error && e.message) || 'Could not send.' }
  }
}
