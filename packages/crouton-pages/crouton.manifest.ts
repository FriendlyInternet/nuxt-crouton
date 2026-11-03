import { defineCroutonManifest } from '@fyit/crouton-core/shared/manifest'

export default defineCroutonManifest({
  id: 'crouton-pages',
  name: 'Pages',
  description: 'CMS-like page management with page types from app packages, tree/sortable layout, public rendering, and custom domain support.',
  icon: 'i-lucide-file-text',
  version: '1.0.0',
  category: 'addon',
  aiHint: 'use when app has CMS pages or landing pages',

  layer: {
    name: 'pages',
    editable: false,
    reason: 'Table names are prefixed with "pages" (e.g., pagesPages). This cannot be changed.',
  },

  dependencies: [
    '@fyit/crouton-core',
    '@fyit/crouton-editor',
  ],

  // The collection below ships from this package (collections/pages), end to end (#2278).
  // The CLI refuses to generate it into an app; `collections` stays as the
  // package's self-description for AI hints and docs.
  ownsCollections: true,

  collections: [
    {
      name: 'pages',
      tableName: 'pagesPages',
      description: 'CMS pages with support for page types from app packages',
      schemaPath: './schemas/pages.json',
      hierarchy: { parentField: 'parentId', orderField: 'order' },
    },
  ],

  provides: {
    composables: [
      'usePageTypes',
      'useDomainContext',
      'useNavigation',
      'usePageBlocks',
    ],
    components: [
      { name: 'CroutonPagesRenderer', description: 'Renders page based on type', props: ['page'] },
      { name: 'CroutonPagesRegularContent', description: 'Rich text content display', props: ['content'] },
      { name: 'CroutonPagesBlockContent', description: 'Block-based content display', props: ['content'] },
      { name: 'CroutonPagesEditorBlockEditor', description: 'Block-based page editor', props: ['modelValue'] },
    ],
    apiRoutes: [
      '/api/teams/[id]/pages',
      '/api/teams/[id]/pages/[slug]',
    ],
  },
})
