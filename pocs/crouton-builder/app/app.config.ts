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
// sizing: every offered block (except Spacer) declares `sizing.height` + `minHeight`
// (#3815): Top bar, Bottom nav and Stats `hug`; lists/forms `fill`. `deriveSizing`
// folds these bottom-up for the floor readout.
// The demo `Gigs · List` options — see the `bookings-list` entry below for why
// they're held in a function.
const BUILDER_BOOKINGS_LIST_FIELDS: NonNullable<CroutonLayoutBlockRegistry[string]['configSchema']> = [
  { name: 'collection', type: 'text', label: 'Collection', default: 'builderBookings' },
  { name: 'heading', type: 'text', label: 'Heading', default: 'Bookings' },
]

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
    // Heading + ~3 rows before a list stops being usable (same as `collection-list`, #3815).
    minHeight: 240,
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
    name: 'Artists · Form',
    description: 'Edit the artist picked in a list, or add a new one',
    icon: 'i-lucide-square-pen',
    component: 'CroutonLayoutForm',
    kind: 'atomic',
    category: 'data',
    minWidth: 320,
    // Heading + ~3 fields + submit (same as `entity-form`, #3815).
    minHeight: 320,
    defaultSize: 50,
    sizing: { width: 'fill', height: 'fill' },
    defaultConfig: { collection: 'builderArtists', heading: 'Artist' },
    configSchema: [
      { name: 'collection', type: 'text', label: 'Collection', default: 'builderArtists' },
      { name: 'heading', type: 'text', label: 'Heading', default: 'Artist' },
    ],
  },
  // Gigs · List — real rows of builderBookings (artists' gigs; content for the chart-style
  // block). Labelled "Gigs" so it never reads as the bookings package's blocks (#2559);
  // the id and collection name stay, so saved pages keep working.
  'bookings-list': {
    id: 'bookings-list',
    name: 'Gigs · List',
    description: 'Live rows of the gigs collection',
    icon: 'i-lucide-calendar-days',
    component: 'CroutonLayoutCollection',
    kind: 'atomic',
    category: 'data',
    minWidth: 260,
    // Set explicitly: otherwise defu silently inherits the package entry's value.
    minHeight: 240,
    defaultSize: 50,
    sizing: { width: 'fill', height: 'fill' },
    defaultConfig: { collection: 'builderBookings', heading: 'Bookings' },
    // @fyit/crouton-bookings registers its own `bookings-list` (#2559) and app config
    // merges with defu, which CONCATENATES arrays — the package's `scope` field would
    // leak into this demo block's options. The function form (Nuxt app.config merge
    // strategy) replaces the lower layer's array instead of appending to it.
    configSchema: (() => BUILDER_BOOKINGS_LIST_FIELDS) as unknown as typeof BUILDER_BOOKINGS_LIST_FIELDS,
  },
  // ── @fyit/crouton-bookings blocks (#2559) ──
  // The package's calendar / filters / locations come straight from its app.config
  // (category 'bookings'). Its list shares the id `bookings-list` with the demo block
  // above, which wins the merge — so the package's list is offered here under its own
  // id, same component + options as the package registers it.
  // Labels: the package's blocks go under "Bookings · …"; the demo collection's list
  // reads "Gigs · List". App config wins the merge on these scalar names; component,
  // sizing and options stay the package's own. The package's Filters block is not
  // offered in the row (see palette-blocks.ts), so it keeps its own name.
  'bookings-calendar-only': { name: 'Bookings · Calendar' } as CroutonLayoutBlockRegistry[string],
  'bookings-locations': { name: 'Bookings · Locations' } as CroutonLayoutBlockRegistry[string],
  'bookings-package-list': {
    id: 'bookings-package-list',
    name: 'Bookings · Bookings list',
    description: 'Live list of bookings (respects the shared filter)',
    icon: 'i-lucide-list',
    component: 'CroutonBookingsLayoutList',
    kind: 'atomic',
    category: 'bookings',
    minWidth: 300,
    // Heading + ~3 rows, same as the package's `bookings-list` it copies (#3815).
    minHeight: 240,
    defaultSize: 40,
    sizing: { width: 'fill', height: 'fill' },
    configSchema: [
      {
        name: 'scope',
        type: 'select',
        label: 'Scope',
        default: 'team',
        options: [
          { label: 'All team bookings', value: 'team' },
          { label: 'My bookings', value: 'personal' },
        ],
      },
    ],
  },
  // Artists · Stats — KPI cards, Fit height (as tall as one row of cards).
  'artists-stats': {
    id: 'artists-stats',
    name: 'Artists · Stats',
    description: 'KPI cards for the artists collection',
    icon: 'i-lucide-bar-chart-3',
    component: 'CroutonLayoutSpikeStats',
    kind: 'atomic',
    category: 'data',
    minWidth: 200,
    minHeight: 96,
    defaultSize: 40,
    sizing: { width: 'fill', height: 'hug' },
  },
  // ── Chrome / layout primitives ──
  // Top bar — declares `height: 'hug'` so it renders as a SHORT pill (intrinsic
  // sizing), no per-instance size UI; `minHeight` 56 matches its `h-14` (#3815).
  'app-toolbar': {
    id: 'app-toolbar',
    name: 'Top bar',
    description: 'A hug-height top bar (pins as a short pill)',
    icon: 'i-lucide-panel-top',
    component: 'BuilderToolbarBlock',
    kind: 'atomic',
    category: 'chrome',
    minWidth: 200,
    minHeight: 56,
    defaultSize: 100,
    sizing: { width: 'fill', height: 'hug' },
  },
  // Bottom nav — also hug-height; `minHeight` 64 matches its `h-16` (#3815).
  'app-nav': {
    id: 'app-nav',
    name: 'Bottom nav',
    description: 'A hug-height bottom navigation bar',
    icon: 'i-lucide-panel-bottom',
    component: 'BuilderNavBlock',
    kind: 'atomic',
    category: 'chrome',
    minWidth: 200,
    minHeight: 64,
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
