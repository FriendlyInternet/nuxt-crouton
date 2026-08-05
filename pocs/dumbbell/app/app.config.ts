import { translationsUiConfig } from '@fyit/crouton-i18n/app/composables/useTranslationsUi'

import {mainPlatesConfig} from '../layers/main/collections/plates/app/composables/useMainPlates';

export default defineAppConfig({
  croutonCollections: {
    translationsUi: translationsUiConfig,
    mainPlates: mainPlatesConfig
  }
})