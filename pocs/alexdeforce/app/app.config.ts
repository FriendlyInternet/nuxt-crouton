import { contentArticlesConfig } from '../layers/content/collections/articles/app/composables/useContentArticles'

import {contentAgendasConfig} from '../layers/content/collections/agendas/app/composables/useContentAgendas';


import {translationsUiConfig} from '@fyit/crouton-i18n/app/composables/useTranslationsUi';

import {contentTagsConfig} from '../layers/content/collections/tags/app/composables/useContentTags';


import {contentCategoriesConfig} from '../layers/content/collections/categories/app/composables/useContentCategories';

export default defineAppConfig({
  croutonCollections: {
    contentArticles: contentArticlesConfig,
    contentAgendas: contentAgendasConfig,
    translationsUi: translationsUiConfig,
    contentTags: contentTagsConfig,
    contentCategories: contentCategoriesConfig
  }
})