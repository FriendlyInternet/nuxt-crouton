// Pure core for the inbox page (`/`) — which cards show, which component renders each, and how a
// tapped answer updates the list. No refs, no $fetch, no auto-imports, so it unit-tests.

export interface InboxCard {
  id: string
  kind: string
  state: string
  askedAt: Date | string | number
  title: string
  ask: string
  recommendation?: string | null
  link: string
  payload?: Record<string, unknown> | null
  sourceType: string
  sourceNumber: number
}

export type CardView = 'review' | 'edit' | 'issue' | 'placeholder'

export interface AnswerInput {
  verdict: unknown
  note?: unknown
}

export interface SendResult {
  status: number
  error?: string | null
}

export type SendAnswer = (cardId: string, body: { verdict: 'ok' | 'not-ok', note: string }) => Promise<SendResult>

const time = (v: Date | string | number) => {
  const t = new Date(v).getTime()
  return Number.isNaN(t) ? 0 : t
}

/** Only the cards still waiting on the owner, newest ask first. Never mutates its input. */
export function waitingCards<T extends InboxCard>(cards: readonly T[] | null | undefined): T[] {
  return (cards ?? [])
    .filter(c => c.state === 'waiting')
    .sort((a, b) => time(b.askedAt) - time(a.askedAt))
}

const hasEditUrl = (card: InboxCard) => typeof card.payload?.editUrl === 'string' && card.payload.editUrl !== ''

/** Which card component renders this card. An edit ask is a `review` card carrying `payload.editUrl`. */
export function cardView(card: InboxCard): CardView {
  if (card.kind === 'review') return hasEditUrl(card) ? 'edit' : 'review'
  if (card.kind === 'issue') return 'issue'
  if (card.kind === 'edit') return hasEditUrl(card) ? 'edit' : 'placeholder'
  return 'placeholder'
}

/** Error text for an answer that must not be sent, or null when it is fine. */
export function validateAnswer(input: AnswerInput): string | null {
  if (input.verdict !== 'ok' && input.verdict !== 'not-ok') return 'Pick ok or not ok.'
  if (input.verdict === 'not-ok' && !(typeof input.note === 'string' && input.note.trim())) return 'Add a short note first.'
  return null
}

/**
 * Send one answer. Invalid → error, nothing sent. 2xx → the card leaves the list.
 * Anything else (non-2xx or a throw) → list unchanged, with the server's error text.
 */
export async function submitAnswer<T extends InboxCard>(args: {
  cards: T[]
  cardId: string
  input: AnswerInput
  send: SendAnswer
}): Promise<{ cards: T[], error: string | null }> {
  const { cards, cardId, input, send } = args
  const invalid = validateAnswer(input)
  if (invalid) return { cards, error: invalid }
  const body = {
    verdict: input.verdict as 'ok' | 'not-ok',
    note: typeof input.note === 'string' ? input.note.trim() : ''
  }
  try {
    const res = await send(cardId, body)
    if (res.status >= 200 && res.status < 300) return { cards: cards.filter(c => c.id !== cardId), error: null }
    return { cards, error: res.error || 'Could not send.' }
  } catch (e) {
    const msg = e instanceof Error ? e.message : ''
    return { cards, error: msg || 'Could not send.' }
  }
}

/** The inbox page's load state. `loading` = the stored list; `refreshing` = the GitHub sync behind it. */
export interface InboxLoadState<T extends InboxCard = InboxCard> {
  cards: T[]
  loading: boolean
  refreshing: boolean
  loadError: string | null
  syncError: string | null
}

/** The readable text of a $fetch error (server statusMessage first), or the fallback. */
export function errorText(e: any, fallback: string): string {
  return e?.data?.statusMessage ?? e?.statusMessage ?? e?.message ?? fallback
}

/** "Nothing waits on you." shows only once the list loaded AND the GitHub refresh is over, and it is empty. */
export function nothingWaits(s: InboxLoadState): boolean {
  return !s.loading && !s.refreshing && !s.loadError && s.cards.length === 0
}

/**
 * Load the inbox: show the stored cards first, then refresh from GitHub in the background and
 * list again. A failed refresh keeps the stored cards and reports `syncError`; a failed list
 * reports `loadError`. Every change goes through `update`, so the page sees each step at once.
 */
export async function loadInbox<T extends InboxCard>(args: {
  list: () => Promise<T[] | unknown>
  sync: () => Promise<unknown>
  update: (patch: Partial<InboxLoadState<T>>) => void
}): Promise<void> {
  const { list, sync, update } = args
  const fetchList = async () => {
    try {
      const result = await list()
      update({ cards: waitingCards(Array.isArray(result) ? result as T[] : []), loadError: null })
    } catch (e) {
      update({ loadError: errorText(e, 'Could not load cards.') })
    }
  }

  update({ loading: true, refreshing: true, loadError: null, syncError: null })
  await fetchList()
  update({ loading: false })

  try {
    await sync()
  } catch (e) {
    update({ syncError: `Could not refresh from GitHub: ${errorText(e, 'sync failed')}`, refreshing: false })
    return
  }
  await fetchList()
  update({ refreshing: false })
}
