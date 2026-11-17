import { translationsUiConfig } from '@fyit/crouton-i18n/app/composables/useTranslationsUi'

import {inboxCardsConfig} from '../layers/inbox/collections/cards/app/composables/useInboxCards';

export default defineAppConfig({
  croutonCollections: {
    translationsUi: translationsUiConfig,
    inboxCards: inboxCardsConfig
  }
})