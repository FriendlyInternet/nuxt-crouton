import { translationsUiConfig } from '@fyit/crouton-i18n/app/composables/useTranslationsUi'

import {widgetPartsConfig} from '../layers/widget/collections/parts/app/composables/useWidgetParts';

export default defineAppConfig({
  croutonCollections: {
    translationsUi: translationsUiConfig,
    widgetParts: widgetPartsConfig
  }
})