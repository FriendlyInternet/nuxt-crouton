import { translationsUiConfig } from '@fyit/crouton-i18n/app/composables/useTranslationsUi'

import {inboxCardsConfig} from '../layers/inbox/collections/cards/app/composables/useInboxCards';

import {pipelineItemsConfig} from '../layers/pipeline/collections/items/app/composables/usePipelineItems';

export default defineAppConfig({
  croutonCollections: {
    translationsUi: translationsUiConfig,
    inboxCards: inboxCardsConfig,
    pipelineItems: pipelineItemsConfig
  }
})