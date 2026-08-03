export default {
  // Feature flags — which crouton packages to enable.
  // crouton-layout is `bundled: true` (default-on), so dropping it from `extends`
  // and package.json is not enough: without this flag `crouton config` writes the
  // extends back and the module warns on every build (#1456, the #1454 lesson).
  features: {
    layout: false
  },

  collections: [
    { name: 'flows', fieldsFile: './schemas/flow.json' },
    { name: 'inputs', fieldsFile: './schemas/input.json' },
    { name: 'outputs', fieldsFile: './schemas/output.json' },
    { name: 'discussions', fieldsFile: './schemas/discussion.json' },
    { name: 'tasks', fieldsFile: './schemas/task.json' },
    { name: 'jobs', fieldsFile: './schemas/job.json' },
    { name: 'users', fieldsFile: './schemas/user.json' },
    { name: 'messages', fieldsFile: './schemas/message.json' },
    {
      name: 'pages',
      fieldsFile: './schemas/pages.json',
      formComponent: 'CroutonPagesForm',
      sortable: true,
      hierarchy: {
        enabled: true,
        parentField: 'parentId',
        orderField: 'order',
        pathField: 'path',
        depthField: 'depth'
      }
    },
    { name: 'categorize-layouts', fieldsFile: './schemas/categorize-layout.json' }
  ],

  targets: [
    {
      layer: 'triage',
      collections: [
        'flows',
        'inputs',
        'outputs',
        'discussions',
        'tasks',
        'jobs',
        'users',
        'messages'
      ]
    },
    { layer: 'pages', collections: ['pages'] },
    { layer: 'categorize', collections: ['categorize-layouts'] }
  ],

  dialect: 'sqlite',

  flags: {
    useTeamUtility: true,
    useMetadata: true,
    autoRelations: true,
    noTranslations: true,
    noDb: false
  }
}
