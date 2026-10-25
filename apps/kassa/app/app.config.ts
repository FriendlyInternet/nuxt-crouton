import { translationsUiConfig } from '@fyit/crouton-i18n/app/composables/useTranslationsUi'
import type { CroutonLayoutBlockRegistry } from '@fyit/crouton-core/app/types/layout-block'

// kassa's own layout blocks (#2532) — merged over the engine's defaults
// (collection-list / entity-form / stats). The events dashboard is composed
// from these in the Layout page.
const croutonLayoutBlocks: CroutonLayoutBlockRegistry = {
  'sales-events-grid': {
    id: 'sales-events-grid',
    name: 'Events',
    description: 'Event cards — each one opens its workspace',
    icon: 'i-lucide-calendar-days',
    component: 'SalesEventsGridBlock',
    kind: 'atomic',
    category: 'sales',
    minWidth: 280,
    defaultSize: 66,
    sizing: { width: 'fill', height: 'hug' },
  },
}

export default defineAppConfig({
  croutonCollections: {
    translationsUi: translationsUiConfig,
  },
  croutonLayoutBlocks,
})
