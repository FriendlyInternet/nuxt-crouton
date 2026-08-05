import { translationsUiConfig } from '@fyit/crouton-i18n/app/composables/useTranslationsUi'

import {mainSnippetsConfig} from '../layers/main/collections/snippets/app/composables/useMainSnippets';

export default defineAppConfig({
  croutonCollections: {
    translationsUi: translationsUiConfig,
    mainSnippets: mainSnippetsConfig
  }
})