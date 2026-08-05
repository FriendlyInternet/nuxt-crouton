import { translationsUiConfig } from '@fyit/crouton-i18n/app/composables/useTranslationsUi'

import {mainNotesConfig} from '../layers/main/collections/notes/app/composables/useMainNotes';

export default defineAppConfig({
  croutonCollections: {
    translationsUi: translationsUiConfig,
    mainNotes: mainNotesConfig
  }
})