import { contentCategoriesConfig } from '../layers/content/collections/categories/app/composables/useContentCategories'

import {contentAteliersConfig} from '../layers/content/collections/ateliers/app/composables/useContentAteliers';

import {contentPersonsConfig} from '../layers/content/collections/persons/app/composables/useContentPersons';

import {contentLocationsConfig} from '../layers/content/collections/locations/app/composables/useContentLocations';

import {contentNewsConfig} from '../layers/content/collections/news/app/composables/useContentNews';

import {contentDownloadsConfig} from '../layers/content/collections/downloads/app/composables/useContentDownloads';



import {translationsUiConfig} from '@fyit/crouton-i18n/app/composables/useTranslationsUi';

export default defineAppConfig({
  ui: {
    colors: {
      primary: 'sintlukas',
      secondary: 'accent',
      neutral: 'slate'
    }
  },
  croutonCollections: {
    contentCategories: contentCategoriesConfig,
    contentAteliers: {
      ...contentAteliersConfig,
      display: {
        title: 'title',
        subtitle: 'age',
        image: 'cardImage',
        badge: 'status'
      },
      references: {
        category: 'contentCategories'
      }
    },
    contentPersons: {
      ...contentPersonsConfig,
      display: {
        title: 'firstName',
        subtitle: 'role',
        image: 'image'
      }
    },
    contentLocations: {
      ...contentLocationsConfig,
      display: {
        title: 'title',
        subtitle: 'city'
      }
    },
    contentNews: {
      ...contentNewsConfig,
      display: {
        title: 'title',
        subtitle: 'text',
        image: 'image'
      }
    },
    contentDownloads: contentDownloadsConfig,
    translationsUi: translationsUiConfig
  }
})