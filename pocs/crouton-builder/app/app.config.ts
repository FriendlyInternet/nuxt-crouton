import { translationsUiConfig } from '@fyit/crouton-i18n/app/composables/useTranslationsUi'
import type { CroutonLayoutBlockRegistry } from '@fyit/crouton-core/app/types/layout-block'

import {builderPagesConfig} from '../layers/builder/collections/pages/app/composables/useBuilderPages';

import {builderArtistsConfig} from '../layers/builder/collections/artists/app/composables/useBuilderArtists';

import {builderBookingsConfig} from '../layers/builder/collections/bookings/app/composables/useBuilderBookings';

// ── Builder blocks (graduated: real collections, not the POC's demo blocks) ──
// The block registry the builder arranges. `defu`-merged with @fyit/crouton-layout's
// defaults (collection-list / entity-form / stats). Real-collection blocks bind a
// package component to a generated collection by name (the `real-collections` spec
// Add — the builder composes REAL data). Sizing (#986, typed) drives intrinsic
// sizing: a Top bar / Bottom nav declare `height: 'hug'` → a short pill wherever
// they land; `deriveSizing` folds these bottom-up for the floor readout.
const croutonLayoutBlocks: CroutonLayoutBlockRegistry = {
  // Artists · List — real rows of builderArtists; `variants` are the bounded
  // display options (the `display-variants` spec Add), surfaced as a first-class
  // field an agent / `resolveVariant` reads, and mirrored in the layout select.
  'artists-list': {
    id: 'artists-list',
    name: 'Artists · List',
    description: 'Live rows of the artists collection',
    icon: 'i-lucide-list',
    component: 'CroutonLayoutCollection',
    kind: 'atomic',
    category: 'data',
    minWidth: 260,
    defaultSize: 50,
    sizing: { width: 'fill', height: 'fill' },
    variants: ['list', 'grid', 'table'],
    defaultConfig: { collection: 'builderArtists', heading: 'Artists' },
    configSchema: [
      { name: 'collection', type: 'text', label: 'Collection', default: 'builderArtists' },
      { name: 'heading', type: 'text', label: 'Heading', default: 'Artists' },
      {
        name: 'layout',
        type: 'select',
        label: 'Display',
        default: 'list',
        options: [
          { label: 'Rows', value: 'list' },
          { label: 'Cards', value: 'grid' },
          { label: 'Table', value: 'table' },
        ],
      },
    ],
  },
  // Artists · New — inline create form for builderArtists.
  'artists-form': {
    id: 'artists-form',
    name: 'Artists · New',
    description: 'Create form for the artists collection',
    icon: 'i-lucide-square-pen',
    component: 'CroutonLayoutForm',
    kind: 'atomic',
    category: 'data',
    minWidth: 320,
    defaultSize: 50,
    sizing: { width: 'fill', height: 'fill' },
    defaultConfig: { collection: 'builderArtists', heading: 'New artist' },
    configSchema: [
      { name: 'collection', type: 'text', label: 'Collection', default: 'builderArtists' },
      { name: 'heading', type: 'text', label: 'Heading', default: 'New artist' },
    ],
  },
  // Bookings · List — real rows of builderBookings (content for the chart-style block).
  'bookings-list': {
    id: 'bookings-list',
    name: 'Bookings · List',
    description: 'Live rows of the bookings collection',
    icon: 'i-lucide-calendar-days',
    component: 'CroutonLayoutCollection',
    kind: 'atomic',
    category: 'data',
    minWidth: 260,
    defaultSize: 50,
    sizing: { width: 'fill', height: 'fill' },
    defaultConfig: { collection: 'builderBookings', heading: 'Bookings' },
    configSchema: [
      { name: 'collection', type: 'text', label: 'Collection', default: 'builderBookings' },
      { name: 'heading', type: 'text', label: 'Heading', default: 'Bookings' },
    ],
  },
  // Artists · Stats — KPI cards (fluid, modest floor).
  'artists-stats': {
    id: 'artists-stats',
    name: 'Artists · Stats',
    description: 'KPI cards for the artists collection',
    icon: 'i-lucide-bar-chart-3',
    component: 'CroutonLayoutSpikeStats',
    kind: 'atomic',
    category: 'data',
    minWidth: 200,
    defaultSize: 40,
    sizing: { width: 'fill', height: 'fill' },
  },
  // ── Chrome / layout primitives ──
  // Top bar — declares `height: 'hug'` so it renders as a SHORT pill (intrinsic
  // sizing), no per-instance size UI. The point of the sizing descriptor.
  'app-toolbar': {
    id: 'app-toolbar',
    name: 'Top bar',
    description: 'A hug-height top bar (pins as a short pill)',
    icon: 'i-lucide-panel-top',
    component: 'BuilderToolbarBlock',
    kind: 'atomic',
    category: 'chrome',
    minWidth: 200,
    defaultSize: 100,
    sizing: { width: 'fill', height: 'hug' },
  },
  // Bottom nav — also hug-height.
  'app-nav': {
    id: 'app-nav',
    name: 'Bottom nav',
    description: 'A hug-height bottom navigation bar',
    icon: 'i-lucide-panel-bottom',
    component: 'BuilderNavBlock',
    kind: 'atomic',
    category: 'chrome',
    minWidth: 200,
    defaultSize: 100,
    sizing: { width: 'fill', height: 'hug' },
  },
  // Spacer — a real, snappable primitive that holds empty space; small minWidth
  // so it can be a thin gutter.
  'spacer': {
    id: 'spacer',
    name: 'Spacer',
    description: 'Empty space — snaps/resizes like any block',
    icon: 'i-lucide-space',
    component: 'BuilderSpacer',
    kind: 'atomic',
    category: 'chrome',
    minWidth: 40,
    defaultSize: 20,
    sizing: { width: 'fill', height: 'fill' },
  },
  // Drop-preview ghost — the ease-apart placeholder spliced in on an armed
  // pane-drop (not a palette block; resolved by the renderer during the gesture).
  '__dropghost__': {
    id: '__dropghost__',
    name: 'Drop preview',
    description: 'Ease-apart placeholder for an armed pane-drop',
    icon: 'i-lucide-plus',
    component: 'BuilderGhostPane',
    kind: 'atomic',
    category: 'chrome',
    minWidth: 60,
  },
}

export default defineAppConfig({
  croutonCollections: {
    translationsUi: translationsUiConfig,
    builderPages: builderPagesConfig,
    builderArtists: builderArtistsConfig,
    builderBookings: builderBookingsConfig
  },
  croutonLayoutBlocks,
})
