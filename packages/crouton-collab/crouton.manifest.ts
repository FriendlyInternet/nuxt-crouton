import { defineCroutonManifest, defineGeneratorContribution } from '@fyit/crouton-core/shared/manifest'

export default defineCroutonManifest({
  id: 'crouton-collab',
  name: 'Collaboration',
  description: 'Real-time collaboration with Yjs CRDTs — WebSocket rooms, presence, and cross-client collection sync',
  icon: 'i-lucide-users',
  version: '1.0.0',
  category: 'addon',
  aiHint: 'use when app needs real-time collaboration or cross-client list sync',
  dependencies: [],

  // Detection patterns — the 'collab: true' collection config flag triggers this package
  detects: {
    collectionConfigFlag: 'collab',
  },

  provides: {
    composables: [
      // Low-level WebSocket connection with exponential backoff reconnection
      'useCollabConnection',
      // High-level Yjs structure sync (map, array, xmlFragment, text)
      'useCollabSync',
      // Cursor/selection presence tracking for all users
      'useCollabPresence',
      // TipTap editor integration (provides Y.Doc, Y.XmlFragment, and awareness provider)
      'useCollabEditor',
      // Collaborative editing of localized content (one Y.XmlFragment per locale)
      'useCollabLocalizedContent',
      // HTTP-poll for room users (global presence in list views)
      'useCollabRoomUsers',
      // Real-time collection cache sync signal across clients via Y.Map
      'useCollectionSyncSignal',
      // Auto-establishes presence when CRUD forms open (used by form-collab plugin)
      'useFormCollabPresence',
    ],
    components: [
      { name: 'CollabStatus', description: 'Connection status indicator with colored dot and optional label' },
      { name: 'CollabPresence', description: 'Stacked user avatars with overflow indicator (+N)' },
      { name: 'CollabCursors', description: 'Remote cursor overlay rendering for canvas/editor content' },
      { name: 'CollabIndicator', description: 'Combined status and presence for toolbars — status dot plus user avatars' },
      { name: 'CollabEditingBadge', description: '"X editing" badge for collection list items via HTTP poll' },
    ],
    apiRoutes: [
      // WebSocket upgrade endpoint — ?type=page|flow|document|sync|generic
      '/api/collab/[roomId]/ws',
      // HTTP endpoint for room user list (Phase 6 global presence)
      '/api/collab/[roomId]/users',
      // Internal Durable Object → Nitro hook bridge (not for public use)
      '/api/_crouton/operation',
    ],
  },
})

// ---------------------------------------------------------------------------
// Generator contribution — adds collab presence indicators to list component
// ---------------------------------------------------------------------------

export const generatorContribution = defineGeneratorContribution({
  enhanceList(ctx) {
    const { detected } = ctx

    if (!detected.collabEnabled) return null

    return {
      collectionProps: `:show-collab-presence="collabConfig"`,
      scriptCode: `
// Get current user for presence filtering
const { data: session } = useSession()

// Collab presence config
const collabConfig = computed(() => ({
  roomType: 'page',
  currentUserId: session.value?.user?.id,
  pollInterval: 5000
}))
`,
    }
  },
})
