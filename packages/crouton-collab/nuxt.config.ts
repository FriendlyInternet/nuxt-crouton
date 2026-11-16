import { fileURLToPath } from 'node:url'
import { join } from 'node:path'

const currentDir = fileURLToPath(new URL('.', import.meta.url))

// Development startup log (deduplicated across layer resolution)
const _dependencies = (globalThis as unknown as Record<string, Set<string>>).__croutonLayers ??= new Set()
if (process.env.NODE_ENV !== 'production' && !_dependencies.has('crouton-collab')) {
  _dependencies.add('crouton-collab')
  console.log('🍞 crouton:collab ✓ Layer loaded')
}

export default defineNuxtConfig({
  $meta: {
    description: 'Real-time collaboration layer for Nuxt Crouton using Yjs CRDTs',
    name: 'crouton-collab'
  },

  // Addon layer: loaded directly or via crouton-flow. It only connects when collabWorkerUrl is set (opt-in, #3810) or in local dev.

  // Runtime config for collab worker URL (production WebSocket direct connection)
  runtimeConfig: {
    public: {
      collabWorkerUrl: process.env.NUXT_PUBLIC_COLLAB_WORKER_URL || '', // e.g. 'https://thinkgraph-collab.cloudflare-e53.workers.dev'
    }
  },

  // Plugins
  plugins: [
    { src: join(currentDir, 'app/plugins/form-collab.client.ts'), mode: 'client' },
    { src: join(currentDir, 'app/plugins/collection-sync.client.ts'), mode: 'client' }
  ],

  // Type exports
  alias: {
    '#collab-types': join(currentDir, 'app/types/collab.ts')
  },

  // Composables auto-import
  imports: {
    dirs: [join(currentDir, 'app/composables')]
  },

  // Components auto-import
  components: {
    dirs: [join(currentDir, 'app/components')]
  },

  // Nitro server configuration for WebSocket sync
  nitro: {
    experimental: {
      websocket: true
    },
    imports: {
      dirs: [join(currentDir, 'server/utils')]
    }
  },

  // Vite optimization for Yjs
  // Note: y-protocols only exports subpaths, no main entry
  vite: {
    optimizeDeps: {
      include: ['yjs', 'y-protocols/sync', 'y-protocols/awareness']
    },
    resolve: {
      dedupe: ['yjs', 'y-protocols', 'lib0']
    }
  }
})
