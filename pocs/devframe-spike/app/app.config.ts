import { translationsUiConfig } from '@fyit/crouton-i18n/app/composables/useTranslationsUi'

import {spikeTasksConfig} from '../layers/spike/collections/tasks/app/composables/useSpikeTasks';

export default defineAppConfig({
  croutonCollections: {
    translationsUi: translationsUiConfig,
    spikeTasks: spikeTasksConfig
  }
})