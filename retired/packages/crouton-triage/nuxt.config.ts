import { fileURLToPath } from 'node:url'
import { join } from 'node:path'

const currentDir = fileURLToPath(new URL('.', import.meta.url))

// Development startup log (deduplicated across layer resolution)
const _dependencies = (globalThis as unknown as Record<string, Set<string>>).__croutonLayers ??= new Set()
if (process.env.NODE_ENV !== 'production' && !_dependencies.has('crouton-triage')) {
  _dependencies.add('crouton-triage')
  console.log('🍞 crouton:triage ✓ Layer loaded')
}

export default defineNuxtConfig({
  // Extend the AI layer for Claude-powered analysis
  extends: ['@fyit/crouton-ai'],

  // Note: This is an addon layer - users must explicitly extend:
  // extends: ['@fyit/crouton-core', '@fyit/crouton-triage', './layers/triage']

  $meta: {
    description: 'Discussion-to-task triage system with AI analysis, multi-source adapters, and domain routing',
    name: 'crouton-triage'
  },

  // Component configuration - prefixed with CroutonTriage
  components: {
    dirs: [
      {
        path: join(currentDir, 'app/components'),
        prefix: 'CroutonTriage',
        global: true
      }
    ]
  },

  // Auto-import composables
  imports: {
    dirs: [join(currentDir, 'app/composables')]
  },

  // Auto-import server utilities
  nitro: {
    imports: {
      dirs: [join(currentDir, 'server/utils')]
    }
  },

  // Runtime config for triage features.
  // Handlers read from BOTH nested and flat paths (legacy inconsistency).
  // All paths must be defined here so Nitro maps NUXT_* env vars at runtime.
  runtimeConfig: {
    // Nested paths — read by Slack webhook handler + AI service
    croutonTriage: {
      anthropicApiKey: '',
      slack: {
        clientId: '',
        clientSecret: '',
        signingSecret: '',
      },
      resend: {
        apiKey: '',
      },
    },
    // Flat paths — read by OAuth install/callback handlers
    slackClientId: '',
    slackClientSecret: '',
    // Flat paths — read by Resend webhook handler
    resendApiToken: '',
    resendWebhookSigningSecret: '',
    // Public config
    public: {
      croutonTriage: {
        enabled: true,
      },
      baseUrl: '',
    },
  },

  // i18n configuration - translations auto-merge when this layer is extended
  i18n: {
    locales: [
      { code: 'en', name: 'English', file: 'en.json' },
      { code: 'nl', name: 'Nederlands', file: 'nl.json' },
      { code: 'fr', name: 'Français', file: 'fr.json' }
    ],
    langDir: '../i18n/locales'
  }
})
