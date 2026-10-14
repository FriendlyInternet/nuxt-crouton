import type { CroutonBlockDefinition } from '@fyit/crouton-core/app/types/block-definition'

const triageBlockDefinition: CroutonBlockDefinition = {
  type: 'triageBlock',
  name: 'Triage',
  description: 'Embed a triage activity feed',
  icon: 'i-lucide-funnel',
  category: 'admin',
  clientOnly: true,
  defaultAttrs: {
    title: '',
    emptyMessage: '',
    limit: 30,
    access: 'public'
  },
  components: {
    editorView: 'CroutonTriageBlocksTriageBlockView',
    renderer: 'CroutonTriageBlocksTriageBlockRender'
  },
  schema: [
    {
      name: 'title',
      type: 'text',
      label: 'Title',
      description: 'Optional heading displayed above the triage feed'
    },
    {
      name: 'emptyMessage',
      type: 'text',
      label: 'Empty message',
      description: 'Message shown when no activity exists'
    },
    {
      name: 'limit',
      type: 'select',
      label: 'Feed limit',
      description: 'Maximum number of items to display',
      options: [
        { label: '10', value: '10' },
        { label: '20', value: '20' },
        { label: '30', value: '30' },
        { label: '50', value: '50' }
      ]
    },
    {
      name: 'access',
      type: 'select',
      label: 'Access',
      description: 'Who can see this triage block',
      options: [
        { label: 'Everyone', value: 'public' },
        { label: 'Members only', value: 'members' }
      ]
    }
  ],
  tiptap: {
    parseHTMLTag: 'div[data-type="triage-block"]',
    attributes: {
      title: { default: '' },
      emptyMessage: { default: '' },
      limit: { default: 30 },
      access: { default: 'public' }
    }
  }
}

export default defineAppConfig({
  // App auto-discovery registration for crouton-triage
  croutonApps: {
    triage: {
      id: 'triage',
      name: 'triage.admin.sectionTitle',
      icon: 'i-lucide-funnel',
      dashboardRoutes: [],
      // Admin routes (appear in /admin/[team]/ sidebar)
      adminRoutes: [
        {
          path: '/triage',
          label: 'triage.admin.overview',
          icon: 'i-lucide-activity'
        },
        {
          path: '/triage/discussions',
          label: 'triage.admin.discussions',
          icon: 'i-lucide-message-square'
        },
        {
          path: '/triage/tasks',
          label: 'triage.admin.tasks',
          icon: 'i-lucide-check-square'
        },
        {
          path: '/triage/jobs',
          label: 'triage.admin.jobs',
          icon: 'i-lucide-activity'
        },
        {
          path: '/triage/inbox',
          label: 'triage.admin.inbox',
          icon: 'i-lucide-inbox'
        }
      ],
      // Settings routes
      settingsRoutes: [],

      // API route prefixes for devtools operation tracking
      apiRoutes: ['/api/crouton-triage/'],

      // Page types for CMS integration
      pageTypes: [
        {
          id: 'triage-feed',
          name: 'Triage Feed',
          description: 'Discussion triage activity feed with pipeline configuration',
          icon: 'i-lucide-activity',
          component: 'CroutonTriagePanel',
          category: 'admin',
          preferredLayout: 'full-height'
        }
      ]
    }
  },
  croutonBlocks: {
    triageBlock: triageBlockDefinition
  }
})
