import { translationsUiConfig } from '@fyit/crouton-i18n/app/composables/useTranslationsUi'




import {pagesPagesConfig} from '../layers/pages/collections/pages/app/composables/usePagesPages';


import {croutonAssetsConfig} from '../layers/crouton/collections/assets/app/composables/useCroutonAssets';



export default defineAppConfig({
  croutonCollections: {
    translationsUi: translationsUiConfig,
    pagesPages: pagesPagesConfig,
    croutonAssets: croutonAssetsConfig,
  }
})