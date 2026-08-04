import { translationsUiConfig } from '@fyit/crouton-i18n/app/composables/useTranslationsUi'

import {mainWidgetsConfig} from '../layers/main/collections/widgets/app/composables/useMainWidgets';

export default defineAppConfig({
  croutonCollections: {
    translationsUi: translationsUiConfig,
    mainWidgets: mainWidgetsConfig
  }
})