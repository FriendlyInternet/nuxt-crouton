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
  name: 'Booking',
  description: 'Embed a booking panel',
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
      label: 'Title',
      description: 'Optional heading displayed above the booking UI'
    },
    {
      name: 'emptyMessage',
      type: 'text',
      label: 'Empty message',
      description: 'Message shown when no bookings exist'
    },
    {
      // Who sees the block at all is the generic Visibility panel; this only
      // decides what a logged-out visitor gets — booking needs an account (#2263)
      name: 'loggedOut',
      type: 'select',
      label: 'Logged-out visitors see',
      description: 'Booking needs an account. Show a login prompt, or hide the block.',
      options: [
        { label: 'A login prompt', value: 'prompt' },
        { label: 'Nothing', value: 'hide' }
      ]
    },
    {
      name: 'scope',
      type: 'select',
      label: 'Booking scope',
      description: 'What bookings are shown to the user',
      options: [
        { label: 'Personal bookings', value: 'personal' },
        { label: 'All team bookings', value: 'team' }
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

export default defineAppConfig({
  // Package-provided form for bookings locations (overrides CLI-generated _Form.vue)
  croutonCollections: {
    bookingsLocations: {
      packageForm: 'CroutonBookingsLocationForm'
    }
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
          name: 'Booking Page',
          description: 'Interactive booking page with calendar and availability',
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
