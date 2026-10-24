import { translationsUiConfig } from '@fyit/crouton-i18n/app/composables/useTranslationsUi'

import {mainItemsConfig} from '../layers/main/collections/items/app/composables/useMainItems';

import {mainGalleriesConfig} from '../layers/main/collections/galleries/app/composables/useMainGalleries';

export default defineAppConfig({
  croutonCollections: {
    translationsUi: translationsUiConfig,
    mainItems: mainItemsConfig,
    mainGalleries: mainGalleriesConfig
  }
})