import type { CroutonLayoutBlockRegistry } from '@fyit/crouton-core/app/types/layout-block'

// Default layout blocks (#704 → real data-bound blocks #709), moved out of
// crouton-core with the layout engine (#751).
// `collection-list` / `entity-form` are REAL data-bound surfaces (they render
// an actual generated collection by name via the `collection` config), placed by
// the deterministic layout pass (`composeDefaultLayout`). Package blocks (e.g. the
// bookings calendar) register the same way through this registry; each layer can
// contribute its own `croutonLayoutBlocks` entries (defu-merged across layers).
// Sizing (#3815): every block writes `sizing.height` out (List/Form `fill`, Stats
// `hug`) plus a `minHeight` floor picked from what the block draws.
const croutonLayoutBlocks: CroutonLayoutBlockRegistry = {
  'collection-list': {
    id: 'collection-list',
    name: 'List',
    description: 'Live rows of a collection',
    icon: 'i-lucide-list',
    component: 'CroutonLayoutCollection',
    kind: 'atomic',
    category: 'data',
    // Sizing contract (#710): a list collapses to cards but needs ~260px to stay legible.
    minWidth: 260,
    // Heading + ~3 rows before a list stops being usable.
    minHeight: 240,
    sizing: { width: 'fill', height: 'fill' },
    defaultSize: 34,
    configSchema: [
      // The collection (registry key, e.g. `mainItems`) this block binds to.
      { name: 'collection', type: 'text', label: 'Collection', default: '' },
      { name: 'heading', type: 'text', label: 'Heading', default: '' },
      {
        name: 'layout',
        type: 'select',
        label: 'Layout',
        default: 'list',
        options: [
          { label: 'List', value: 'list' },
          { label: 'Grid', value: 'grid' },
          { label: 'Table', value: 'table' },
        ],
      },
      // Page-context render (#983): on a PAGE a list is a content-sized block —
      // it shows `pageSize` items, then a bounded viewer control. Ignored in the
      // admin (fill-and-scroll) context.
      { name: 'pageSize', type: 'number', label: 'Items per page', default: 10 },
      {
        name: 'viewer',
        type: 'select',
        label: 'Viewer',
        default: 'load-more',
        options: [
          { label: 'Load more', value: 'load-more' },
          { label: 'Paginate', value: 'paginate' },
          { label: 'Search', value: 'search' },
        ],
      },
    ],
  },
  'entity-form': {
    id: 'entity-form',
    name: 'Form',
    description: 'Create form for a collection',
    icon: 'i-lucide-square-pen',
    component: 'CroutonLayoutForm',
    kind: 'atomic',
    category: 'data',
    // A form drops to a single column under ~480px; below ~320px fields crush.
    minWidth: 320,
    // Heading + ~3 fields + submit.
    minHeight: 320,
    sizing: { width: 'fill', height: 'fill' },
    defaultSize: 50,
    configSchema: [
      { name: 'collection', type: 'text', label: 'Collection', default: '' },
      { name: 'heading', type: 'text', label: 'Heading', default: '' },
    ],
  },
  'stats': {
    id: 'stats',
    name: 'Stats',
    description: 'KPI cards',
    icon: 'i-lucide-bar-chart-3',
    component: 'CroutonLayoutSpikeStats',
    kind: 'atomic',
    category: 'data',
    // KPI cards reflow to one column gracefully (modest width floor); Fit height —
    // as tall as one row of cards (`p-4` + one UCard).
    minWidth: 200,
    minHeight: 96,
    sizing: { width: 'fill', height: 'hug' },
    defaultSize: 40,
  },
}

export default defineAppConfig({
  croutonLayoutBlocks,
})
