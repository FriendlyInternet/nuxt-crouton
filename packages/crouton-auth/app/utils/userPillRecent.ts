import type { DropdownMenuItem } from '@nuxt/ui'

/** The single "Récent" slide-out item, or null when there is nothing to put in it (#3986). */
export function buildRecentMenuItem(opts: {
  label: string
  /** already-mapped recent rows */
  entries: DropdownMenuItem[]
  /** "Voir toute l'activité" link, or null when not allowed */
  seeAll?: DropdownMenuItem | null
}): DropdownMenuItem | null {
  const children = [...opts.entries, ...(opts.seeAll ? [opts.seeAll] : [])]
  if (!children.length) return null
  return { label: opts.label, icon: 'i-lucide-history', slot: 'recent', children }
}
