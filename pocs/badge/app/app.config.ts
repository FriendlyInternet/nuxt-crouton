import { translationsUiConfig } from '@fyit/crouton-i18n/app/composables/useTranslationsUi'

import {mainAwardsConfig} from '../layers/main/collections/awards/app/composables/useMainAwards';

export default defineAppConfig({
  croutonCollections: {
    translationsUi: translationsUiConfig,
    mainAwards: mainAwardsConfig
  }
})