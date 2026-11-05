import { translationsUiConfig } from '@fyit/crouton-i18n/app/composables/useTranslationsUi'

import {crateTracksConfig} from '../layers/crate/collections/tracks/app/composables/useCrateTracks';

import {cratePilesConfig} from '../layers/crate/collections/piles/app/composables/useCratePiles';

import {crateLookupsConfig} from '../layers/crate/collections/lookups/app/composables/useCrateLookups';

import {crateChangesConfig} from '../layers/crate/collections/changes/app/composables/useCrateChanges';

export default defineAppConfig({
  croutonCollections: {
    translationsUi: translationsUiConfig,
    crateTracks: crateTracksConfig,
    cratePiles: cratePilesConfig,
    crateLookups: crateLookupsConfig,
    crateChanges: crateChangesConfig
  }
})