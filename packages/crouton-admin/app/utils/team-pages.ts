/**
 * The one ordered list of team admin pages (#4220).
 *
 * Both the admin side menu's Team section (crouton-core `AdminSidebar.vue`) and
 * the Équipe tabs (`pages/admin/[team]/team.vue`) draw from this list, so they
 * show the same pages in the same order. Each entry's `can` is the action its
 * page asks in `definePageMeta({ can })`, so a menu only links to pages that
 * will open. Wire it to live rights with `useTeamAdminPages()`.
 *
 * Pure — no Nuxt imports — so vitest can load it directly.
 */

export interface TeamAdminPageDef {
  key: string
  /** i18n key */
  label: string
  /** label when the i18n key has no translation */
  fallback: string
  icon: string
  /** path relative to `/admin/<team>` */
  path: string
  /** the action the page's `definePageMeta({ can })` asks */
  can: string
  /** how the side menu decides "you are here" — default exact */
  match?: 'exact' | 'prefix'
}

export interface TeamAdminPage extends TeamAdminPageDef {
  /** full link, `/admin/<team><path>` */
  to: string
}

export const TEAM_ADMIN_PAGES: readonly TeamAdminPageDef[] = [
  { key: 'settings', label: 'teams.teamSettings', fallback: 'Settings', icon: 'i-lucide-settings', path: '/team/settings', can: 'team:manage' },
  { key: 'members', label: 'teams.members', fallback: 'Members', icon: 'i-lucide-users', path: '/team', can: 'team:manage', match: 'exact' },
  { key: 'invitations', label: 'teams.invitations', fallback: 'Invitations', icon: 'i-lucide-mail', path: '/team/invitations', can: 'team:manage' },
  { key: 'roles', label: 'teams.rolesScreen.tab', fallback: 'Roles', icon: 'i-lucide-shield-check', path: '/team/roles', can: 'team:manage' },
  { key: 'look-and-feel', label: 'teams.lookAndFeel', fallback: 'Look and feel', icon: 'i-lucide-palette', path: '/team/look-and-feel', can: 'site:manage' },
  { key: 'site-info', label: 'teams.siteInfo.tab', fallback: 'Site info', icon: 'i-lucide-info', path: '/team/site-info', can: 'site:manage' },
  { key: 'translations', label: 'navigation.translations', fallback: 'Translations', icon: 'i-lucide-languages', path: '/translations', can: 'translations:manage', match: 'prefix' },
  { key: 'domains', label: 'teams.domains.title', fallback: 'Domains', icon: 'i-lucide-globe', path: '/team/domains', can: 'team:domains' },
  { key: 'redirects', label: 'redirects.title', fallback: 'Redirects', icon: 'i-lucide-arrow-right-left', path: '/team/redirects', can: 'site:manage' },
  { key: 'email-templates', label: 'emailTemplates.title', fallback: 'Email Templates', icon: 'i-lucide-mail-open', path: '/team/email-templates', can: 'team:manage' },
  { key: 'email-logs', label: 'emailLogs.title', fallback: 'Email Logs', icon: 'i-lucide-mail-check', path: '/team/email-logs', can: 'team:manage' }
]

/** Every distinct action the list asks, in first-seen order. */
export const TEAM_ADMIN_ACTIONS: readonly string[] = [...new Set(TEAM_ADMIN_PAGES.map(p => p.can))]

/** The pages this member may open, in list order, with full links. `[]` with no team. */
export function teamAdminPages(teamParam: string | null | undefined, allowed: (action: string) => boolean): TeamAdminPage[] {
  if (!teamParam) return []
  return TEAM_ADMIN_PAGES
    .filter(page => allowed(page.can))
    .map(page => ({ ...page, to: `/admin/${teamParam}${page.path}` }))
}

type Translate = (key: string) => string

function pageLabel(page: TeamAdminPage, t: Translate): string {
  return t(page.label) || page.fallback
}

/** Items for `CroutonTabsPanel` (one row). */
export function toTabItems(pages: TeamAdminPage[], t: Translate) {
  return pages.map(page => ({
    label: pageLabel(page, t),
    icon: page.icon,
    to: page.to,
    ...(page.match === 'exact' ? { exact: true } : {})
  }))
}

/** Items for the side menu, with "you are here" highlighting. */
export function toSidebarItems(pages: TeamAdminPage[], t: Translate, routePath: string) {
  return pages.map((page) => {
    const exact = routePath === page.to || routePath === `${page.to}/`
    const active = page.match === 'prefix' ? exact || routePath.startsWith(`${page.to}/`) : exact
    return {
      label: pageLabel(page, t),
      icon: page.icon,
      to: page.to,
      active
    }
  })
}
