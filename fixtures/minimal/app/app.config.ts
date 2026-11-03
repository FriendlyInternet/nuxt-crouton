import { translationsUiConfig } from '@fyit/crouton-i18n/app/composables/useTranslationsUi'

import {mainItemsConfig} from '../layers/main/collections/items/app/composables/useMainItems';

import {mainAdmindocsConfig} from '../layers/main/collections/admindocs/app/composables/useMainAdmindocs';

import {mainMembernotesConfig} from '../layers/main/collections/membernotes/app/composables/useMainMembernotes';

export default defineAppConfig({
  croutonCollections: {
    translationsUi: translationsUiConfig,
    mainItems: mainItemsConfig,
    mainAdmindocs: mainAdmindocsConfig,
    mainMembernotes: mainMembernotesConfig
  }
})