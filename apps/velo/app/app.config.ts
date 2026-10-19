import { translationsUiConfig } from '@fyit/crouton-i18n/app/composables/useTranslationsUi'






import {croutonAssetsConfig} from '../layers/crouton/collections/assets/app/composables/useCroutonAssets';



export default defineAppConfig({
  croutonCollections: {
    translationsUi: translationsUiConfig,
    croutonAssets: croutonAssetsConfig,
  }
})