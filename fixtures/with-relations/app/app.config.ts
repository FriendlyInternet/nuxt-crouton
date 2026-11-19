import { mainCategoriesConfig } from '../layers/main/collections/categories/app/composables/useMainCategories'

import {mainProductsConfig} from '../layers/main/collections/products/app/composables/useMainProducts';

import {translationsUiConfig} from '@fyit/crouton-i18n/app/composables/useTranslationsUi';

export default defineAppConfig({
  croutonCollections: {
    mainCategories: mainCategoriesConfig,
    mainProducts: mainProductsConfig,
    translationsUi: translationsUiConfig
  }
})