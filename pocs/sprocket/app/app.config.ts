import { translationsUiConfig } from '@fyit/crouton-i18n/app/composables/useTranslationsUi'

import {sprocketCogsConfig} from '../layers/sprocket/collections/cogs/app/composables/useSprocketCogs';

export default defineAppConfig({
  croutonCollections: {
    translationsUi: translationsUiConfig,
    sprocketCogs: sprocketCogsConfig
  }
})