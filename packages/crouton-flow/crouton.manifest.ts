import { defineCroutonManifest } from '@fyit/crouton-core/shared/manifest'

export default defineCroutonManifest({
  id: 'crouton-flow',
  name: 'Flow',
  description: 'Interactive node graph visualization for collections with real-time multiplayer sync',
  icon: 'i-lucide-share-2',
  version: '1.0.0',
  category: 'addon',
  aiHint: 'use when app needs graph/DAG visualization, decision trees, or flow diagrams',
  dependencies: ['crouton-collab'],

  // Registers as 'flow' app — detectable via useCroutonApps().hasApp('flow')
  croutonApp: {
    id: 'flow',
    adminRoutes: [{ path: '/flows', label: 'Flows', icon: 'i-lucide-share-2' }],
  },

  // NuxtHub auto-discovers the flow_configs table via server/db/schema.ts
  // which re-exports flowConfigs from server/database/schema.ts
  // Migration: server/database/migrations/0002_flow_configs.sql

  provides: {
    composables: [
      'useFlowSync',
      'useFlowPresence',
      'useFlowData',
      'useFlowLayout',
      'useFlowMutation',
    ],
    components: [
      {
        name: 'CroutonFlow',
        description: 'Interactive node graph with DAG auto-layout, drag/drop, minimap, and optional real-time sync',
      },
    ],
    apiRoutes: [
      '/api/crouton-flow/teams/[id]/flows',
      '/api/crouton-flow/teams/[id]/flows/[flowId]',
    ],
    pages: [
      '/admin/[team]/flows',
      '/admin/[team]/flows/[flowId]',
    ],
  },
})
