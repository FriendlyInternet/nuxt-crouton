import type { CroutonBlockDefinition } from '@fyit/crouton-core/app/types/block-definition'
import type { CroutonLayoutBlockRegistry } from '@fyit/crouton-core/app/types/layout-block'
import { SALES_CHART_KIND_OPTIONS } from './utils/chart-blocks'

// Placeable layout blocks (#711 test) — the Event Workspace surfaces exposed to
// the deterministic layout engine, so the workspace can be reproduced from a
// layout *data tree* (rendered by CroutonLayoutRenderer) instead of the
// hand-coded splitter in EventWorkspace/Shell.vue. Each takes the event by slug
// (its only config field). minWidth/defaultSize mirror Shell's SplitterPanel
// min-size/default-size so the viability gate keeps the same proportions.
const croutonLayoutBlocks: CroutonLayoutBlockRegistry = {
  // The kassa — the workspace's primary surface (Shell `pos` panel, min-size 35).
  'sales-pos': {
    id: 'sales-pos',
    name: 'sales.blocks.layout.pos.name',
    description: 'sales.blocks.layout.pos.description',
    icon: 'i-lucide-shopping-cart',
    component: 'SalesLayoutPos',
    kind: 'compound',
    category: 'kassa',
    minWidth: 480,
    defaultSize: 45,
    configSchema: [
      { name: 'eventSlug', type: 'text', label: 'sales.blocks.layout.eventSlug', default: '' },
    ],
  },
  // The live orders pane (Shell `orders` panel, default-size 30 / min-size 18).
  'sales-orders': {
    id: 'sales-orders',
    name: 'sales.blocks.layout.orders.name',
    description: 'sales.blocks.layout.orders.description',
    icon: 'i-lucide-clipboard-list',
    component: 'SalesLayoutOrders',
    kind: 'compound',
    category: 'kassa',
    minWidth: 280,
    defaultSize: 30,
    configSchema: [
      { name: 'eventSlug', type: 'text', label: 'sales.blocks.layout.eventSlug', default: '' },
    ],
  },
  // The open-client-tabs pane (Shell `clients` panel, default-size 25 / min-size 15).
  'sales-clients': {
    id: 'sales-clients',
    name: 'sales.blocks.layout.clients.name',
    description: 'sales.blocks.layout.clients.description',
    icon: 'i-lucide-users',
    component: 'SalesLayoutClients',
    kind: 'compound',
    category: 'kassa',
    minWidth: 240,
    defaultSize: 25,
    configSchema: [
      { name: 'eventSlug', type: 'text', label: 'sales.blocks.layout.eventSlug', default: '' },
    ],
  },
}

// Sales analytics block for crouton-pages: editor picks a chart kind and an
// event scope (one event or all). Renders via CroutonChartsWidget when
// @fyit/crouton-charts is installed; degrades to a notice otherwise.
const salesChartBlock: CroutonBlockDefinition = {
  type: 'salesChartBlock',
  name: 'sales.blocks.salesChart.name',
  description: 'sales.blocks.salesChart.description',
  icon: 'i-lucide-chart-bar',
  category: 'data',
  clientOnly: true,
  defaultAttrs: {
    chart: 'revenue-by-day',
    eventScope: '',
    chartTypeOverride: 'default',
    title: '',
    height: 300
  },
  components: {
    editorView: 'SalesBlocksChartBlockView',
    renderer: 'SalesBlocksChartBlockRender'
  },
  propertyComponents: {
    'sales-event-scope': 'SalesBlocksPropertiesEventScopePicker'
  },
  schema: [
    {
      name: 'chart',
      type: 'select',
      label: 'sales.blocks.salesChart.fields.chart.label',
      description: 'sales.blocks.salesChart.fields.chart.description',
      defaultValue: 'revenue-by-day',
      // Option labels point at i18n keys so the dropdown is translated in the
      // editor panel; the public renderer keeps using SALES_CHART_KINDS labels.
      options: SALES_CHART_KIND_OPTIONS.map(o => ({
        label: `sales.blocks.salesChart.chartKinds.${o.value}`,
        value: o.value
      }))
    },
    {
      name: 'eventScope',
      type: 'sales-event-scope',
      label: 'sales.blocks.salesChart.fields.eventScope.label',
      description: 'sales.blocks.salesChart.fields.eventScope.description'
    },
    {
      name: 'chartTypeOverride',
      type: 'select',
      label: 'sales.blocks.salesChart.fields.chartTypeOverride.label',
      description: 'sales.blocks.salesChart.fields.chartTypeOverride.description',
      defaultValue: 'default',
      options: [
        { label: 'sales.blocks.salesChart.fields.chartTypeOverride.options.default', value: 'default' },
        { label: 'sales.blocks.salesChart.fields.chartTypeOverride.options.bar', value: 'bar' },
        { label: 'sales.blocks.salesChart.fields.chartTypeOverride.options.line', value: 'line' },
        { label: 'sales.blocks.salesChart.fields.chartTypeOverride.options.area', value: 'area' },
        { label: 'sales.blocks.salesChart.fields.chartTypeOverride.options.donut', value: 'donut' }
      ]
    },
    {
      name: 'title',
      type: 'text',
      label: 'sales.blocks.salesChart.fields.title.label',
      description: 'sales.blocks.salesChart.fields.title.description'
    },
    {
      name: 'height',
      type: 'select',
      label: 'sales.blocks.salesChart.fields.height.label',
      defaultValue: '300',
      options: [
        { label: '200px', value: '200' },
        { label: '300px', value: '300' },
        { label: '400px', value: '400' },
        { label: '500px', value: '500' }
      ]
    }
  ],
  tiptap: {
    parseHTMLTag: 'div[data-type="sales-chart-block"]',
    attributes: {
      chart: { default: 'revenue-by-day' },
      eventScope: { default: '' },
      chartTypeOverride: { default: 'default' },
      title: { default: '' },
      height: { default: 300, htmlAttr: 'data-height', parseType: 'int' }
    }
  }
}

// Sales product × day pivot table for crouton-pages: rows = products,
// columns = days, last column = total, with an interactive Units/Revenue
// toggle. Pure UTable — no charts dependency.
const salesProductMatrixBlock: CroutonBlockDefinition = {
  type: 'salesProductMatrixBlock',
  name: 'sales.blocks.salesProductMatrix.name',
  description: 'sales.blocks.salesProductMatrix.description',
  icon: 'i-lucide-table',
  category: 'data',
  clientOnly: true,
  defaultAttrs: {
    eventScope: '',
    measure: 'units',
    title: ''
  },
  components: {
    editorView: 'SalesBlocksProductMatrixView',
    renderer: 'SalesBlocksProductMatrixRender'
  },
  propertyComponents: {
    'sales-event-scope': 'SalesBlocksPropertiesEventScopePicker'
  },
  schema: [
    {
      name: 'eventScope',
      type: 'sales-event-scope',
      label: 'sales.blocks.salesProductMatrix.fields.eventScope.label',
      description: 'sales.blocks.salesProductMatrix.fields.eventScope.description'
    },
    {
      name: 'measure',
      type: 'select',
      label: 'sales.blocks.salesProductMatrix.fields.measure.label',
      description: 'sales.blocks.salesProductMatrix.fields.measure.description',
      defaultValue: 'units',
      options: [
        { label: 'sales.blocks.salesProductMatrix.fields.measure.options.units', value: 'units' },
        { label: 'sales.blocks.salesProductMatrix.fields.measure.options.revenue', value: 'revenue' }
      ]
    },
    {
      name: 'title',
      type: 'text',
      label: 'sales.blocks.salesProductMatrix.fields.title.label',
      description: 'sales.blocks.salesProductMatrix.fields.title.description'
    }
  ],
  tiptap: {
    parseHTMLTag: 'div[data-type="sales-product-matrix-block"]',
    attributes: {
      eventScope: { default: '' },
      measure: { default: 'units' },
      title: { default: '' }
    }
  }
}

// The single sales surface for CMS pages: the event workspace, which shows a
// different face per session. The editor fixes the event by slug. Anonymous
// visitors (volunteers) get the kassa only — inline helper PIN login + order
// interface (this absorbed the removed orderInterfaceBlock, incl. its
// `height` attribute). Signed-in team members get the full workspace shell
// (kassa + settings/orders/clients panes; switcher hidden).
// name/description and schema labels/descriptions are i18n keys, translated
// by the crouton-pages block editor/panel via useT(). See i18n/locales/*.json.
const eventWorkspaceBlock: CroutonBlockDefinition = {
  type: 'eventWorkspaceBlock',
  name: 'sales.blocks.eventWorkspace.name',
  description: 'sales.blocks.eventWorkspace.description',
  icon: 'i-lucide-layout-dashboard',
  category: 'kassa',
  clientOnly: true,
  // On a 'scoped' page this block provides the access scope: the server's
  // derive-scope hook (server/plugins/scoped-access.ts) answers
  // ('event', eventId), so the page gate redeems the event's helper PIN.
  // This flag only mirrors that for the page editor's hint.
  providesScope: true,
  defaultAttrs: {
    eventSlug: '',
    height: 'tall'
  },
  components: {
    editorView: 'SalesBlocksEventWorkspaceView',
    renderer: 'SalesBlocksEventWorkspaceRender'
  },
  propertyComponents: {
    eventSlug: 'SalesBlocksPropertiesEventSlugPicker'
  },
  schema: [
    {
      name: 'eventSlug',
      type: 'eventSlug',
      label: 'sales.blocks.eventWorkspace.fields.eventSlug.label',
      description: 'sales.blocks.eventWorkspace.fields.eventSlug.description'
    },
    {
      name: 'height',
      type: 'select',
      label: 'sales.blocks.eventWorkspace.fields.height.label',
      description: 'sales.blocks.eventWorkspace.fields.height.description',
      defaultValue: 'tall',
      options: [
        { label: 'sales.blocks.eventWorkspace.fields.height.options.compact', value: 'compact' },
        { label: 'sales.blocks.eventWorkspace.fields.height.options.tall', value: 'tall' },
        { label: 'sales.blocks.eventWorkspace.fields.height.options.fill', value: 'fill' }
      ]
    }
  ],
  tiptap: {
    parseHTMLTag: 'div[data-type="event-workspace-block"]',
    attributes: {
      eventSlug: { default: '' },
      height: { default: 'tall' }
    }
  }
}

// Live Dashboard for crouton-pages (#179, epic #175 — D1 live mirror): one
// event's mirror-fresh orders + sales, read from the Cloudflare D1 mirror. A
// composition of existing pieces — a mirror-freshness banner (the only new
// part), a sales summary on the chart endpoints, and the workspace orders list
// — so an admin can open a browser anywhere and watch the venue live, with a
// clear "last synced" indicator that goes stale when the Pi is offline.
// Team-members-only (the renderer gates on useAuth().loggedIn — mirror data is
// team-scoped). The editor fixes the event by slug. name/description and field
// labels are i18n keys (see i18n/locales/*.json).
const salesLiveDashboardBlock: CroutonBlockDefinition = {
  type: 'salesLiveDashboardBlock',
  name: 'sales.blocks.liveDashboard.name',
  description: 'sales.blocks.liveDashboard.description',
  icon: 'i-lucide-layout-dashboard',
  category: 'data',
  clientOnly: true,
  defaultAttrs: {
    eventSlug: '',
    title: ''
  },
  components: {
    editorView: 'SalesBlocksLiveDashboardView',
    renderer: 'SalesBlocksLiveDashboardRender'
  },
  propertyComponents: {
    eventSlug: 'SalesBlocksPropertiesEventSlugPicker'
  },
  schema: [
    {
      name: 'eventSlug',
      type: 'eventSlug',
      label: 'sales.blocks.liveDashboard.fields.eventSlug.label',
      description: 'sales.blocks.liveDashboard.fields.eventSlug.description'
    },
    {
      name: 'title',
      type: 'text',
      label: 'sales.blocks.liveDashboard.fields.title.label',
      description: 'sales.blocks.liveDashboard.fields.title.description'
    }
  ],
  tiptap: {
    parseHTMLTag: 'div[data-type="sales-live-dashboard-block"]',
    attributes: {
      eventSlug: { default: '' },
      title: { default: '' }
    }
  }
}

// Standalone Orders block for crouton-pages: one event's live orders list
// (the same view as the workspace "Bestellingen" pane) on its own page, so an
// admin can build a dedicated orders / kitchen-status screen. Team-members-only
// — the renderer gates on useAuth().loggedIn (the orders data is team-scoped),
// non-members get a hint. The editor fixes the event by slug. name/description
// and field labels are i18n keys (see i18n/locales/*.json).
const salesOrdersBlock: CroutonBlockDefinition = {
  type: 'salesOrdersBlock',
  name: 'sales.blocks.salesOrders.name',
  description: 'sales.blocks.salesOrders.description',
  icon: 'i-lucide-receipt',
  category: 'kassa',
  clientOnly: true,
  defaultAttrs: {
    eventSlug: ''
  },
  components: {
    editorView: 'SalesBlocksOrdersView',
    renderer: 'SalesBlocksOrdersRender'
  },
  propertyComponents: {
    eventSlug: 'SalesBlocksPropertiesEventSlugPicker'
  },
  schema: [
    {
      name: 'eventSlug',
      type: 'eventSlug',
      label: 'sales.blocks.salesOrders.fields.eventSlug.label',
      description: 'sales.blocks.salesOrders.fields.eventSlug.description'
    }
  ],
  tiptap: {
    parseHTMLTag: 'div[data-type="sales-orders-block"]',
    attributes: {
      eventSlug: { default: '' }
    }
  }
}

// Standalone Clients block for crouton-pages: one event's open client tabs
// (the same view as the workspace "Klanten" pane — active clients with the
// settle / print-receipt action) on its own page. Team-members-only and only
// meaningful for recurring-client events: the renderer gates on
// useAuth().loggedIn and on event.requiresClient (a note otherwise). The editor
// fixes the event by slug. name/description and field labels are i18n keys.
const salesClientsBlock: CroutonBlockDefinition = {
  type: 'salesClientsBlock',
  name: 'sales.blocks.salesClients.name',
  description: 'sales.blocks.salesClients.description',
  icon: 'i-lucide-users',
  category: 'kassa',
  clientOnly: true,
  defaultAttrs: {
    eventSlug: ''
  },
  components: {
    editorView: 'SalesBlocksClientsView',
    renderer: 'SalesBlocksClientsRender'
  },
  propertyComponents: {
    eventSlug: 'SalesBlocksPropertiesEventSlugPicker'
  },
  schema: [
    {
      name: 'eventSlug',
      type: 'eventSlug',
      label: 'sales.blocks.salesClients.fields.eventSlug.label',
      description: 'sales.blocks.salesClients.fields.eventSlug.description'
    }
  ],
  tiptap: {
    parseHTMLTag: 'div[data-type="sales-clients-block"]',
    attributes: {
      eventSlug: { default: '' }
    }
  }
}

// Kitchen Display (KDS) for crouton-pages: a drop-on-a-page screen — typically
// an iPad — that renders the orders routed to a `display`-driver station and
// lets staff bump them done. Reads display jobs straight off the print queue
// (salesPrintqueues); the editor fixes the event by slug. name/description and
// field labels are i18n keys (see i18n/locales/*.json).
const kitchenDisplayBlock: CroutonBlockDefinition = {
  type: 'kitchenDisplayBlock',
  name: 'sales.blocks.kitchenDisplay.name',
  description: 'sales.blocks.kitchenDisplay.description',
  icon: 'i-lucide-monitor',
  category: 'kassa',
  clientOnly: true,
  defaultAttrs: {
    eventSlug: '',
    locations: []
  },
  components: {
    editorView: 'SalesBlocksKitchenDisplayView',
    renderer: 'SalesBlocksKitchenDisplayRender'
  },
  propertyComponents: {
    eventSlug: 'SalesBlocksPropertiesEventSlugPicker',
    locations: 'SalesBlocksPropertiesLocationsPicker'
  },
  schema: [
    {
      name: 'eventSlug',
      type: 'eventSlug',
      label: 'sales.blocks.kitchenDisplay.fields.eventSlug.label',
      description: 'sales.blocks.kitchenDisplay.fields.eventSlug.description'
    },
    {
      name: 'locations',
      type: 'locations',
      label: 'sales.blocks.kitchenDisplay.fields.locations.label',
      description: 'sales.blocks.kitchenDisplay.fields.locations.description'
    }
  ],
  tiptap: {
    parseHTMLTag: 'div[data-type="kitchen-display-block"]',
    attributes: {
      eventSlug: { default: '' },
      locations: { default: [] }
    }
  }
}

// Print Bridge — the browser-side drainer for the `browser-print` (AirPrint)
// output driver. A drop-on-a-page screen near the printer that prints pending
// tickets via the OS print dialog. The editor fixes the event by slug.
const printBridgeBlock: CroutonBlockDefinition = {
  type: 'printBridgeBlock',
  name: 'sales.blocks.printBridge.name',
  description: 'sales.blocks.printBridge.description',
  icon: 'i-lucide-printer',
  category: 'kassa',
  clientOnly: true,
  defaultAttrs: {
    eventSlug: ''
  },
  components: {
    editorView: 'SalesBlocksPrintBridgeView',
    renderer: 'SalesBlocksPrintBridgeRender'
  },
  propertyComponents: {
    eventSlug: 'SalesBlocksPropertiesEventSlugPicker'
  },
  schema: [
    {
      name: 'eventSlug',
      type: 'eventSlug',
      label: 'sales.blocks.printBridge.fields.eventSlug.label',
      description: 'sales.blocks.printBridge.fields.eventSlug.description'
    }
  ],
  tiptap: {
    parseHTMLTag: 'div[data-type="print-bridge-block"]',
    attributes: {
      eventSlug: { default: '' }
    }
  }
}

export default defineAppConfig({
  // App auto-discovery registration for crouton-sales
  croutonApps: {
    sales: {
      id: 'sales',
      name: 'sales.title',
      icon: 'i-lucide-shopping-cart',
      // API route prefixes for devtools operation tracking
      apiRoutes: ['/api/crouton-sales/'],
      // Admin routes (appear in /admin/[team]/ sidebar).
      // Each entry maps 1:1 to a page under app/pages/admin/[team]/sales/.
      adminRoutes: [
        {
          path: '/sales',
          label: 'sales.admin.overview',
          icon: 'i-lucide-shopping-cart'
        },
        {
          path: '/sales/events',
          label: 'sales.sidebar.events',
          icon: 'i-lucide-calendar'
        },
        {
          path: '/sales/products',
          label: 'sales.sidebar.products',
          icon: 'i-lucide-package'
        },
        {
          path: '/sales/categories',
          label: 'sales.sidebar.categories',
          icon: 'i-lucide-folder'
        },
        {
          path: '/sales/orders',
          label: 'sales.orders.title',
          icon: 'i-lucide-receipt'
        },
        {
          path: '/sales/locations',
          label: 'sales.sidebar.locations',
          icon: 'i-lucide-map-pin'
        },
        {
          path: '/sales/printers',
          label: 'sales.sidebar.printers',
          icon: 'i-lucide-printer'
        },
        {
          path: '/sales/helpers',
          label: 'sales.sidebar.helpers',
          icon: 'i-lucide-users'
        },
        {
          path: '/sales/clients',
          label: 'sales.sidebar.clients',
          icon: 'i-lucide-user'
        }
      ],
      dashboardRoutes: [],
      settingsRoutes: [],
      // Page types for crouton-pages CMS integration. Appears in the page
      // type selector at /admin/[team]/pages.
      pageTypes: []
    }
  },
  croutonBlocks: {
    eventWorkspaceBlock,
    salesLiveDashboardBlock,
    salesOrdersBlock,
    salesClientsBlock,
    kitchenDisplayBlock,
    printBridgeBlock,
    salesChartBlock,
    salesProductMatrixBlock
  },
  // Placeable layout blocks (#711 test) — see the registry definition above.
  croutonLayoutBlocks
})
