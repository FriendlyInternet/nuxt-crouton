import { describe, it, expect } from 'vitest'
import { teamAdminPages, toTabItems, toSidebarItems, TEAM_ADMIN_ACTIONS } from '../app/utils/team-pages'

/**
 * #4220 — the admin side menu's Team section and the Équipe tabs draw from one
 * list, so they show the same pages in the same order, and only pages the
 * member may open.
 */

const t = (_key: string) => ''
const all = () => true

const EXPECTED = [
  '/admin/x/team/settings',
  '/admin/x/team',
  '/admin/x/team/invitations',
  '/admin/x/team/roles',
  '/admin/x/team/look-and-feel',
  '/admin/x/team/site-info',
  '/admin/x/translations',
  '/admin/x/team/domains',
  '/admin/x/team/redirects',
  '/admin/x/team/email-templates',
  '/admin/x/team/email-logs'
]

describe('team admin pages (#4220)', () => {
  // covers: T1
  it('gives the tabs and the side menu the same ten pages in the same order', () => {
    const pages = teamAdminPages('x', all)
    expect(toTabItems(pages, t).map(i => i.to)).toEqual(EXPECTED)
    expect(toSidebarItems(pages, t, '/admin/x').map(i => i.to)).toEqual(EXPECTED)
    expect(TEAM_ADMIN_ACTIONS).toEqual(['team:manage', 'site:manage', 'translations:manage', 'team:domains'])
    // fallback label when translation is missing
    expect(toTabItems(pages, t)[7]!.label).toBe('Domains')
  })

  // covers: T2
  it('drops a refused page from both lists and keeps the rest in order', () => {
    const noDomains = teamAdminPages('x', a => a !== 'team:domains')
    const want = EXPECTED.filter(p => p !== '/admin/x/team/domains')
    expect(toTabItems(noDomains, t).map(i => i.to)).toEqual(want)
    expect(toSidebarItems(noDomains, t, '/').map(i => i.to)).toEqual(want)

    const noSite = teamAdminPages('x', a => a !== 'site:manage')
    const wantNoSite = EXPECTED.filter(p => !/look-and-feel|site-info|redirects/.test(p))
    expect(toTabItems(noSite, t).map(i => i.to)).toEqual(wantNoSite)
    expect(toSidebarItems(noSite, t, '/').map(i => i.to)).toEqual(wantNoSite)

    expect(teamAdminPages('', all)).toEqual([])
    expect(teamAdminPages(null, all)).toEqual([])
  })

  // covers: T3
  it('highlights the page you are on the way the side menu always has', () => {
    const pages = teamAdminPages('x', all)
    const activeOn = (path: string) => toSidebarItems(pages, t, path).filter(i => i.active).map(i => i.to)

    expect(activeOn('/admin/x/team')).toEqual(['/admin/x/team'])
    expect(activeOn('/admin/x/team/')).toEqual(['/admin/x/team'])
    expect(activeOn('/admin/x/team/settings')).toEqual(['/admin/x/team/settings'])
    expect(activeOn('/admin/x/team/settings/')).toEqual(['/admin/x/team/settings'])
    expect(activeOn('/admin/x/translations/foo')).toEqual(['/admin/x/translations'])

    const tabs = toTabItems(pages, t)
    expect(tabs.find(i => i.to === '/admin/x/team')).toMatchObject({ exact: true })
    expect(tabs.filter(i => 'exact' in i)).toHaveLength(1)
  })
})
