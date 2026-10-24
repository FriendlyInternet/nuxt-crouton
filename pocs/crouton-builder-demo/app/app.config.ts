import { translationsUiConfig } from '@fyit/crouton-i18n/app/composables/useTranslationsUi'

export default defineAppConfig({
  croutonCollections: {
    translationsUi: translationsUiConfig,
  },
  // Backend-free demo blocks for the builder preview — both reuse the generic KPI
  // block under DISTINCT ids so the collapse demo collapses one pane and reflows the
  // other (collapse is keyed by blockId). defu-merged with the crouton-layout defaults.
  // `sizing` (#971): the intrinsic sizing descriptor — `{ width, height: 'fill' | 'hug' }` — declared
  // as DATA so the renderer / viability metric / an agent read one source ("the component decides").
  // A bar HUGS its height (→ short pill wherever pinned); list/form/stats/chart FILL. Defaults to fill.
  croutonLayoutBlocks: {
    'demo-a': { id: 'demo-a', name: 'Overview', description: 'Demo KPIs', icon: 'i-lucide-bar-chart-3', component: 'CroutonLayoutSpikeStats', kind: 'atomic', category: 'data', minWidth: 200, defaultSize: 40, sizing: { width: 'fill', height: 'fill' } },
    'demo-b': { id: 'demo-b', name: 'Detail', description: 'Demo KPIs', icon: 'i-lucide-bar-chart-3', component: 'CroutonLayoutSpikeStats', kind: 'atomic', category: 'data', minWidth: 200, defaultSize: 60, sizing: { width: 'fill', height: 'fill' } },
    // Spike (#903): the blocks a collection ("Artists") would offer — list / form / stats.
    // All render the backend-free KPI block; the spike is about the drawer→drag→compile
    // loop, not the block fidelity. Distinct names/icons so the drawer reads right.
    // Distinct demo blocks (#956) — each renders a DIFFERENT, recognizable UI so you can see which
    // block landed where (list vs form vs chart vs toolbar vs nav), instead of every card looking alike.
    // Display variants (#970) — `variant` is a BOUNDED ENUM (select) declared on the registry, so the
    // renderer's `sanitizeConfig` keeps only a known value and the edit-view picker (and an agent) read
    // one source. Serialised on the leaf's `config.variant`; the block renders rows / cards / table.
    'artists-list': {
      id: 'artists-list', name: 'Artists · List', description: 'All artists', icon: 'i-lucide-list', component: 'SpikeListBlock', kind: 'atomic', category: 'data', minWidth: 200, defaultSize: 50, sizing: { width: 'fill', height: 'fill' },
      configSchema: [{
        name: 'variant', type: 'select', label: 'Display', default: 'rows',
        options: [
          { label: 'Rows', value: 'rows' },
          { label: 'Cards', value: 'cards' },
          { label: 'Table', value: 'table' },
        ],
      }],
    },
    'artists-form': { id: 'artists-form', name: 'Artists · New', description: 'Create an artist', icon: 'i-lucide-square-pen', component: 'SpikeFormBlock', kind: 'atomic', category: 'form', minWidth: 200, defaultSize: 50, sizing: { width: 'fill', height: 'fill' } },
    'artists-stats': { id: 'artists-stats', name: 'Artists · Stats', description: 'Artist KPIs', icon: 'i-lucide-bar-chart-3', component: 'CroutonLayoutSpikeStats', kind: 'atomic', category: 'data', minWidth: 180, defaultSize: 50, sizing: { width: 'fill', height: 'fill' } },
    'artists-chart': { id: 'artists-chart', name: 'Bookings · Chart', description: 'Bookings per week', icon: 'i-lucide-bar-chart-3', component: 'SpikeChartBlock', kind: 'atomic', category: 'data', minWidth: 200, defaultSize: 50, sizing: { width: 'fill', height: 'fill' } },
    // Bars HUG their height → a pinned Top bar / Bottom nav comes out SHORT automatically (#971).
    'app-toolbar': { id: 'app-toolbar', name: 'Top bar', description: 'Title + search + actions (pin to top)', icon: 'i-lucide-panel-top', component: 'SpikeToolbarBlock', kind: 'atomic', category: 'data', minWidth: 200, defaultSize: 100, sizing: { width: 'fill', height: 'hug' } },
    'app-nav': { id: 'app-nav', name: 'Bottom nav', description: 'Tab bar (pin to bottom)', icon: 'i-lucide-panel-bottom', component: 'SpikeNavBlock', kind: 'atomic', category: 'data', minWidth: 200, defaultSize: 100, sizing: { width: 'fill', height: 'hug' } },
    // Spacer (#952): a layout primitive that renders empty space — add it to push blocks around or
    // hold a gap. A real block, so it snaps/reorders/resizes like any other; small minWidth so it can
    // be a thin gutter. Renders SpikeSpacer (a faint dashed hint in the builder, blank in a real app).
    'spacer': { id: 'spacer', name: 'Spacer', description: 'Empty space (push blocks around / hold a gap)', icon: 'i-lucide-square-dashed', component: 'SpikeSpacer', kind: 'atomic', category: 'data', minWidth: 40, defaultSize: 20, sizing: { width: 'fill', height: 'fill' } },
    // Drop-ghost (#946): the placeholder pane spliced in while an internal insert is armed, so the
    // real panes ease apart to open its slot. NOT shown in the drawer (that list is hardcoded). A
    // small minWidth so opening the slot never forces the split to stack.
    '__dropghost__': { id: '__dropghost__', name: 'Drop preview', description: 'Where the dragged item lands', icon: 'i-lucide-plus', component: 'SpikeGhostPane', kind: 'atomic', category: 'data', minWidth: 60 }
  }
})
