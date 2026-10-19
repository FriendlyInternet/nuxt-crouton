/**
 * Team Favicon Composable
 *
 * Generates and applies a dynamic favicon based on team context:
 * 1. Custom uploaded favicon (from site settings) — highest priority
 * 2. Auto-generated SVG from team initials + theme color
 * 3. Default crouton favicon (/favicon.svg) — fallback
 *
 * @example
 * ```typescript
 * // Called from team-theme plugin after theme loads
 * useTeamFavicon()
 * ```
 */
import type { ThemePrimaryColor } from './useTeamTheme'

/**
 * Tailwind primary color → hex (500 shade) mapping
 */
const COLOR_HEX: Record<ThemePrimaryColor, string> = {
  red: '#ef4444',
  orange: '#f97316',
  amber: '#f59e0b',
  yellow: '#eab308',
  lime: '#84cc16',
  green: '#22c55e',
  emerald: '#10b981',
  teal: '#14b8a6',
  cyan: '#06b6d4',
  sky: '#0ea5e9',
  blue: '#3b82f6',
  indigo: '#6366f1',
  violet: '#8b5cf6',
  purple: '#a855f7',
  fuchsia: '#d946ef',
  pink: '#ec4899',
  rose: '#f43f5e'
}

/**
 * Generate an SVG favicon data URI from team initials and primary color.
 */
function generateInitialsFavicon(name: string, primaryColor: ThemePrimaryColor): string {
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .map(w => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase()

  const hex = COLOR_HEX[primaryColor] ?? COLOR_HEX.emerald
  const fontSize = initials.length === 1 ? 20 : 15

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="6" fill="${hex}"/><text x="16" y="${initials.length === 1 ? 22 : 21}" text-anchor="middle" fill="white" font-family="system-ui,-apple-system,sans-serif" font-size="${fontSize}" font-weight="700">${initials}</text></svg>`

  return `data:image/svg+xml,${encodeURIComponent(svg)}`
}

/**
 * Apply a team-specific favicon based on site settings, team name, and theme color.
 * Falls back to the default crouton favicon when no team is active.
 */
export function useTeamFavicon() {
  const { teamId } = useTeamContext()
  const { currentTeam } = useTeam()
  const { theme } = useTeamTheme()

  // Site settings state — populated by the team-theme plugin or lazy-fetched
  const siteSettings = useState<{ favicon?: string } | null>('team-site-settings', () => null)

  const faviconHref = computed(() => {
    // No team context — use default
    if (!teamId.value || !currentTeam.value) {
      return '/favicon.svg'
    }

    // 1. Custom uploaded favicon (stored as blob pathname)
    if (siteSettings.value?.favicon) {
      return `/images/${siteSettings.value.favicon}`
    }

    // 2. Auto-generated from team initials + theme color
    if (currentTeam.value.name) {
      return generateInitialsFavicon(currentTeam.value.name, theme.value.primary)
    }

    // 3. Default
    return '/favicon.svg'
  })

  useHead({
    // Only the generated/default icons are SVG; an uploaded one can be PNG, ICO, …
    link: [{ rel: 'icon', type: computed(() => siteSettings.value?.favicon ? undefined : 'image/svg+xml'), href: faviconHref }]
  })

  return { faviconHref }
}
