import { translationsUiConfig } from '@fyit/crouton-i18n/app/composables/useTranslationsUi'

import {choresChoresConfig} from '../layers/chores/collections/chores/app/composables/useChoresChores';

export default defineAppConfig({
  croutonCollections: {
    translationsUi: translationsUiConfig,
    choresChores: choresChoresConfig
  }
})