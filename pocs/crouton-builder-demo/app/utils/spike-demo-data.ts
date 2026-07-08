/**
 * Spike demo data (#906/#940) — the drawer's demo blocks and the demo pages the Site
 * flow shows. Auto-imported (app/utils) so spike-app.vue's script AND template read them
 * without ceremony, like spike-page-meta's *_META tables.
 */
import type { LayoutTree } from '@fyit/crouton-core/app/types/layout'
import type { PageLayout, PageStatus, PageVisibility } from './spike-page-meta'

// The drawer = the blocks a collection ("Artists") offers. In the real thing this list
// is derived from the collection; here it's the registered demo blocks.
export const drawer = [
  // Distinct demo blocks (#956) — each renders a different, recognizable UI.
  { blockId: 'artists-list', label: 'Artists · List', icon: 'i-lucide-list' },
  { blockId: 'artists-form', label: 'Artists · New', icon: 'i-lucide-square-pen' },
  { blockId: 'artists-stats', label: 'Artists · Stats', icon: 'i-lucide-gauge' },
  { blockId: 'artists-chart', label: 'Bookings · Chart', icon: 'i-lucide-bar-chart-3' },
  { blockId: 'app-toolbar', label: 'Top bar', icon: 'i-lucide-panel-top' },
  { blockId: 'app-nav', label: 'Bottom nav', icon: 'i-lucide-panel-bottom' },
  // Layout primitive (#952): empty space you can add + snap/resize like a block, to push others around.
  { blockId: 'spacer', label: 'Spacer', icon: 'i-lucide-square-dashed' },
]

// Mirror @fyit/crouton-pages' real page model (#940): the builder is just another VIEW of the pages
// collection, so the header reflects the package's actual fields/enums/icons (see
// packages/crouton-pages/schemas/pages.json + app/components/Editor/Toolbar.vue). Demo values here;
// the real builder reads the page row — and at graduation should REUSE the package's toolbar/settings
// rather than mirror them.
export interface BuilderPage {
  id: string, label: string, icon?: string, path?: string
  status?: PageStatus, visibility?: PageVisibility, layout?: PageLayout, showInNavigation?: boolean
  tree: LayoutTree
}
const pageSplit = (a: string, b: string, dir: 'horizontal' | 'vertical' = 'horizontal'): LayoutTree['root'] => ({
  type: 'split', direction: dir,
  children: [{ type: 'leaf', blockId: a, defaultSize: 50 }, { type: 'leaf', blockId: b, defaultSize: 50 }],
})
export const PAGES: BuilderPage[] = [
  {
    id: 'dashboard', label: 'Dashboard', icon: 'i-lucide-layout-dashboard',
    path: '/dashboard', status: 'published', visibility: 'members', layout: 'default', showInNavigation: true,
    tree: { renderer: 'panes', root: { type: 'split', direction: 'horizontal', children: [
      { type: 'leaf', blockId: 'artists-list', defaultSize: 34 },
      { type: 'leaf', blockId: 'artists-stats', defaultSize: 33 },
      { type: 'leaf', blockId: 'artists-form', defaultSize: 33 },
    ] } },
  },
  { id: 'reports', label: 'Reports', icon: 'i-lucide-bar-chart-3', path: '/reports', status: 'draft', visibility: 'admin', layout: 'full-height', showInNavigation: true, tree: { renderer: 'panes', root: pageSplit('artists-stats', 'artists-list') } },
  { id: 'settings', label: 'Settings', icon: 'i-lucide-settings', path: '/settings', status: 'published', visibility: 'public', layout: 'default', showInNavigation: false, tree: { renderer: 'panes', root: { type: 'leaf', blockId: 'artists-form' } } },
]
// The same pages as crouton-flow rows (Dashboard is root; others hang off it) — ENRICHED from PAGES
// so the Site-flow cards carry the settings (status · visibility · layout · nav · icon · path) they
// display condensed. Parent wiring (parentId) is the sitemap hierarchy.
const PAGE_PARENTS: Record<string, string | null> = { dashboard: null, reports: 'dashboard', settings: 'dashboard' }
export const pageRows = PAGES.map(p => ({
  id: p.id, label: p.label, parentId: PAGE_PARENTS[p.id] ?? null,
  icon: p.icon, path: p.path, status: p.status, visibility: p.visibility,
  layout: p.layout, showInNavigation: p.showInNavigation,
}))
export const pageById = (id: unknown) => PAGES.find(p => p.id === String(id))
