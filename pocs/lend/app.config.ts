import { lendLoansConfig } from './layers/lend/collections/loans/app/composables/useLendLoans'

import {translationsUiConfig} from '@fyit/crouton-i18n/app/composables/useTranslationsUi';

export default defineAppConfig({
  croutonCollections: {
    lendLoans: lendLoansConfig,
    translationsUi: translationsUiConfig
  }
})