import { translationsUiConfig } from '@fyit/crouton-i18n/app/composables/useTranslationsUi'

import {trinketItemsConfig} from '../layers/trinket/collections/items/app/composables/useTrinketItems';

export default defineAppConfig({
  croutonCollections: {
    translationsUi: translationsUiConfig,
    trinketItems: trinketItemsConfig
  }
})