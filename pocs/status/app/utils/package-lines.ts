// Pure helper for the ⚠️ "Touches <package>" lines on a review card (#3785). The sync puts
// `payload.packages = [{ name, why, approval }]` on a PR review card that changes `packages/<name>/`;
// this turns it into one line per package. No auto-imports, so it unit-tests in plain Node.
import type { InboxCard } from './inbox-core'

export const REPO_URL = 'https://github.com/FriendlyInternet/nuxt-crouton'
export const NO_WHY_TEXT = 'No plain reason was written — read the diff.'

export interface PackageLine {
  name: string
  why: string | null
  /** `why`, or the fallback sentence when none was written. */
  whyText: string
  approval: string | null
  filesUrl: string
}

const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v : null)

export function packageLines(card: InboxCard): PackageLine[] {
  if (card.sourceType !== 'pr') return []
  const packages = card.payload?.packages
  if (!Array.isArray(packages) || !packages.length) return []
  const filesUrl = `${REPO_URL}/pull/${card.sourceNumber}/files`
  const out: PackageLine[] = []
  for (const p of packages as Array<Record<string, unknown> | null>) {
    const name = str(p?.name)
    if (!name) continue
    const why = str(p?.why)
    out.push({ name, why, whyText: why ?? NO_WHY_TEXT, approval: str(p?.approval), filesUrl })
  }
  return out
}
