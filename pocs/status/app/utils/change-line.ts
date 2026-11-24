// Pure helper for the "what changed" line on a PR review card (#4373). The sync puts
// `payload.changes = { files, added, removed, top }` on a PR review card whose file list was read;
// this turns it into one short line plus the PR's Files-tab link. No auto-imports, so it unit-tests in plain Node.
import type { InboxCard } from './inbox-core'
import { REPO_URL } from './package-lines'

export interface ChangeLine {
  text: string
  filesUrl: string
}

const isCount = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0

/** Last two path parts: `pocs/status/app/components/cards/Review.vue` → `cards/Review.vue`. */
const short = (name: string) => name.split('/').filter(Boolean).slice(-2).join('/')

export function changeLine(card: InboxCard): ChangeLine | null {
  if (card.sourceType !== 'pr') return null
  const c = card.payload?.changes as Record<string, unknown> | null | undefined
  if (!c || typeof c !== 'object') return null
  const { files, added, removed } = c
  if (!isCount(files) || files < 1 || !isCount(added) || !isCount(removed)) return null
  const top = Array.isArray(c.top) ? c.top.filter((t): t is string => typeof t === 'string' && !!t) : []
  let text = `${files} ${files === 1 ? 'file' : 'files'} · +${added} −${removed}`
  if (top.length) text += ` · ${top.map(short).join(', ')}`
  return { text, filesUrl: `${REPO_URL}/pull/${card.sourceNumber}/files` }
}
