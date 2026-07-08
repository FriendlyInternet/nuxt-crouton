import { translationsUiConfig } from '@fyit/crouton-i18n/app/composables/useTranslationsUi'

import {mainBookmarksConfig} from '../layers/main/collections/bookmarks/app/composables/useMainBookmarks';

export default defineAppConfig({
  croutonCollections: {
    translationsUi: translationsUiConfig,
    mainBookmarks: mainBookmarksConfig
  }
})