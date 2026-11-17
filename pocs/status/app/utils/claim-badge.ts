// Pure helper for the chat-claim badge on an inbox card (#4019). The sync puts
// `payload.claim = { chat, name }` on a card whose ticket (or parent epic) a chat claimed
// (server/utils/claim-core.ts); this turns it into the badge text. No auto-imports, so it unit-tests.
import type { InboxCard } from './inbox-core'

/** `"c7f3a1 · products"`, `"c7f3a1"` with no name, or null (no claim / not a 6-hex chat id). */
export function claimBadge(card: Pick<InboxCard, 'payload'>): string | null {
  const claim = card.payload?.claim as { chat?: unknown, name?: unknown } | null | undefined
  if (!claim || typeof claim !== 'object') return null
  const chat = typeof claim.chat === 'string' ? claim.chat.toLowerCase() : ''
  if (!/^[0-9a-f]{6}$/.test(chat)) return null
  const name = typeof claim.name === 'string' ? claim.name.trim() : ''
  return name ? `${chat} · ${name}` : chat
}
