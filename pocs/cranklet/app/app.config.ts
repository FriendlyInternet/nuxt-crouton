import { translationsUiConfig } from '@fyit/crouton-i18n/app/composables/useTranslationsUi'

import {crankletLeversConfig} from '../layers/cranklet/collections/levers/app/composables/useCrankletLevers';

export default defineAppConfig({
  croutonCollections: {
    translationsUi: translationsUiConfig,
    crankletLevers: crankletLeversConfig
  }
})