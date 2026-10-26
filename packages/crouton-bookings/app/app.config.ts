import { bookingsBookingsConfig } from '../collections/bookings/app/composables/useBookingsBookings'
import { bookingsLocationsConfig } from '../collections/locations/app/composables/useBookingsLocations'
import { bookingsSettingsConfig } from '../collections/settings/app/composables/useBookingsSettings'
import { bookingsEmailtemplatesConfig } from '../collections/emailtemplates/app/composables/useBookingsEmailtemplates'
import { bookingsEmaillogsConfig } from '../collections/emaillogs/app/composables/useBookingsEmaillogs'
// The five collections above ship with this package (#2278); registering them here
// means a consuming app lists nothing for bookings in its own app.config.
import type { CroutonBlockDefinition } from '@fyit/crouton-core/app/types/block-definition'
import type { CroutonLayoutBlockRegistry } from '@fyit/crouton-core/app/types/layout-block'

// Placeable layout block (#709): the bookings calendar as a compound surface the
// deterministic layout pass reaches for → a "calendar-primary" arrangement. Wide
// `minWidth` so the viability gate keeps it in a roomy pane.
//
// Plus the ATOMIC blocks (#924 gap test): the Panel's sub-surfaces broken out so a
// user can reassemble the native layout from blocks. They coordinate cross-pane via
// the shared `useBookingsLayoutFilters` store (the layout tree can't wire pane↔pane
// — see that composable + the #924 report). All take an optional `scope` config.
const layoutScopeConfig = [
  {
    name: 'scope',
    type: 'select' as const,
    label: 'Scope',
    default: 'team',
    options: [
      { label: 'All team bookings', value: 'team' },
      { label: 'My bookings', value: 'personal' },
    ],
  },
]

const croutonLayoutBlocks: CroutonLayoutBlockRegistry = {
  'bookings-calendar': {
    id: 'bookings-calendar',
    name: 'Calendar',
    description: 'Bookings calendar + availability',
    icon: 'i-lucide-calendar',
    component: 'CroutonBookingsLayoutCalendar',
    kind: 'compound',
    category: 'bookings',
    minWidth: 520,
    defaultSize: 65,
  },
  // Atomic: JUST the calendar grid (no list/filters), self-fetching + shared-filter aware.
  'bookings-calendar-only': {
    id: 'bookings-calendar-only',
    name: 'Calendar (only)',
    description: 'Just the availability calendar grid',
    icon: 'i-lucide-calendar-days',
    component: 'CroutonBookingsLayoutCalendarOnly',
    kind: 'atomic',
    category: 'bookings',
    minWidth: 460,
    defaultSize: 60,
    configSchema: layoutScopeConfig,
  },
  // Atomic: the bookings list.
  'bookings-list': {
    id: 'bookings-list',
    name: 'Bookings list',
    description: 'Live list of bookings (respects the shared filter)',
    icon: 'i-lucide-list',
    component: 'CroutonBookingsLayoutList',
    kind: 'atomic',
    category: 'bookings',
    minWidth: 300,
    defaultSize: 40,
    configSchema: layoutScopeConfig,
  },
  // Atomic: the location picker (drives the shared location filter).
  'bookings-locations': {
    id: 'bookings-locations',
    name: 'Locations',
    description: 'Pick locations to filter by',
    icon: 'i-lucide-map-pin',
    component: 'CroutonBookingsLayoutLocations',
    kind: 'atomic',
    category: 'bookings',
    minWidth: 220,
    defaultSize: 25,
    configSchema: layoutScopeConfig,
  },
  // Atomic: the filter controls (status / location / cancelled → shared store).
  'bookings-filters': {
    id: 'bookings-filters',
    name: 'Filters',
    description: 'Status / location / cancelled filter controls',
    icon: 'i-lucide-filter',
    component: 'CroutonBookingsLayoutFilters',
    kind: 'atomic',
    category: 'bookings',
    minWidth: 240,
    defaultSize: 25,
    configSchema: layoutScopeConfig,
  },
}

const bookingBlockDefinition: CroutonBlockDefinition = {
  type: 'bookingBlock',
  name: 'bookings.blocks.booking.name',
  description: 'bookings.blocks.booking.description',
  icon: 'i-lucide-calendar-check',
  category: 'customer',
  clientOnly: true,
  defaultAttrs: {
    title: '',
    emptyMessage: '',
    loggedOut: 'prompt',
    scope: 'personal'
  },
  components: {
    editorView: 'CroutonBookingsBlocksBookingBlockView',
    renderer: 'CroutonBookingsBlocksBookingBlockRender'
  },
  schema: [
    {
      name: 'title',
      type: 'text',
      label: 'bookings.blocks.booking.fields.title.label',
      description: 'bookings.blocks.booking.fields.title.description'
    },
    {
      name: 'emptyMessage',
      type: 'text',
      label: 'bookings.blocks.booking.fields.emptyMessage.label',
      description: 'bookings.blocks.booking.fields.emptyMessage.description'
    },
    {
      // Who sees the block at all is the generic Visibility panel; this only
      // decides what a logged-out visitor gets — booking needs an account (#2263)
      name: 'loggedOut',
      type: 'select',
      label: 'bookings.blocks.booking.fields.loggedOut.label',
      description: 'bookings.blocks.booking.fields.loggedOut.description',
      options: [
        { label: 'bookings.blocks.booking.fields.loggedOut.options.prompt', value: 'prompt' },
        { label: 'bookings.blocks.booking.fields.loggedOut.options.hide', value: 'hide' }
      ]
    },
    {
      name: 'scope',
      type: 'select',
      label: 'bookings.blocks.booking.fields.scope.label',
      description: 'bookings.blocks.booking.fields.scope.description',
      options: [
        { label: 'bookings.blocks.booking.fields.scope.options.personal', value: 'personal' },
        { label: 'bookings.blocks.booking.fields.scope.options.team', value: 'team' }
      ]
    }
  ],
  tiptap: {
    parseHTMLTag: 'div[data-type="booking-block"]',
    attributes: {
      title: { default: '' },
      emptyMessage: { default: '' },
      loggedOut: { default: 'prompt' },
      scope: { default: 'personal' }
    }
  }
}

// Sidebar label = the title key this package already ships for the collection
const withNavLabel = <T extends object>(config: T, labelKey: string) => ({
  ...config,
  adminNav: { label: labelKey }
})

export default defineAppConfig({
  croutonCollections: {
    bookingsBookings: withNavLabel(bookingsBookingsConfig, 'bookings.collections.bookings.title'),
    // Package-provided form for locations (overrides the generated _Form.vue)
    bookingsLocations: { ...withNavLabel(bookingsLocationsConfig, 'bookings.collections.locations.title'), packageForm: 'CroutonBookingsLocationForm' },
    bookingsSettings: withNavLabel(bookingsSettingsConfig, 'bookings.collections.settings.title'),
    bookingsEmailtemplates: withNavLabel(bookingsEmailtemplatesConfig, 'bookings.collections.emailtemplates.title'),
    bookingsEmaillogs: withNavLabel(bookingsEmaillogsConfig, 'bookings.collections.emaillogs.title')
  },
  // App auto-discovery registration for crouton-bookings
  croutonApps: {
    bookings: {
      id: 'bookings',
      name: 'bookings.title',
      icon: 'i-lucide-calendar',
      // User-facing routes (appear in /dashboard/[team]/ sidebar)
      dashboardRoutes: [
        {
          path: '/bookings',
          label: 'bookings.myBookings.title',
          icon: 'i-lucide-calendar'
        }
      ],
      // Admin routes (appear in /admin/[team]/ sidebar)
      // These appear as sub-items under the "Bookings" section
      adminRoutes: [
        {
          path: '/bookings',
          label: 'bookings.admin.overview',
          icon: 'i-lucide-calendar'
        },
        {
          path: '/bookings/locations',
          label: 'bookings.admin.locations',
          icon: 'i-lucide-map-pin'
        },
        {
          path: '/bookings/settings',
          label: 'bookings.admin.settings',
          icon: 'i-lucide-settings'
        },
        {
          path: '/bookings/email-templates',
          label: 'bookings.settings.emailTemplates',
          icon: 'i-lucide-mail'
        },
        {
          path: '/bookings/email-logs',
          label: 'bookings.settings.emailLogs',
          icon: 'i-lucide-file-text'
        }
      ],
      // Settings routes - empty (booking settings are under /bookings/ not /settings/)
      settingsRoutes: [],

      // API route prefixes for devtools operation tracking
      apiRoutes: ['/api/crouton-bookings/'],

      // Page types for CMS integration
      // These appear when creating pages in /admin/[team]/pages
      pageTypes: [
        {
          id: 'booking',
          name: 'bookings.pageTypes.booking.name',
          description: 'bookings.pageTypes.booking.description',
          icon: 'i-lucide-calendar',
          component: 'CroutonBookingsPanel',
          category: 'customer',
          preferredLayout: 'full-height'
        }
      ]
    }
  },
  croutonBlocks: {
    bookingBlock: bookingBlockDefinition
  },
  croutonLayoutBlocks
})
