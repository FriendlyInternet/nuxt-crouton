import { fileURLToPath } from 'node:url'
import vue from '@vitejs/plugin-vue'

// Development startup log (deduplicated across layer resolution)
const _dependencies = (globalThis as unknown as Record<string, Set<string>>).__croutonLayers ??= new Set()
if (process.env.NODE_ENV !== 'production' && !_dependencies.has('crouton-email')) {
  _dependencies.add('crouton-email')
  console.log('🍞 crouton:email ✓ Layer loaded')
}

export default defineNuxtConfig({
  // Layer metadata
  $meta: {
    name: '@crouton/email',
    version: '0.1.0'
  },

  // Components from the layer
  components: [
    { path: 'app/components', pathPrefix: false }
  ],

  // Auto-imports from the layer
  imports: {
    dirs: ['app/composables']
  },

  // Runtime config defaults
  runtimeConfig: {
    // Server-only config (private)
    email: {
      resendApiKey: '', // NUXT_EMAIL_RESEND_API_KEY (or RESEND_API_KEY for local dev via process.env)
      from: '', // EMAIL_FROM (e.g., noreply@example.com)
      fromName: '', // EMAIL_FROM_NAME (e.g., My App)
      replyTo: '' // EMAIL_REPLY_TO (optional)
    },

    // Public config
    public: {
      crouton: {
        email: {
          // Brand customization for email templates
          brand: {
            name: 'My App',
            logoUrl: '', // Optional logo URL for email headers
            primaryColor: '#0F766E', // Teal-700
            url: '' // App URL for links in emails
          },
          // Verification settings
          verification: {
            codeLength: 6,
            codeExpiry: 10, // minutes
            resendCooldown: 60 // seconds
          },
          // Magic link settings
          magicLink: {
            expiry: 10, // minutes
            resendCooldown: 60 // seconds
          }
        }
      } as any
    }
  },

  // Compatibility
  compatibilityDate: '2024-11-01',

  // Alias for consuming packages (e.g., crouton-bookings)
  alias: {
    '#crouton-email': fileURLToPath(new URL('./', import.meta.url))
  },

  // Nitro server config
  nitro: {
    scanDirs: ['./server'],
    imports: {
      dirs: ['server/utils']
    },
    // Bundle this package's own files (brand/email-brand.mjs is imported by the
    // server/emails templates but lives outside app/ and server/, so Nitro treated
    // it as an external and emitted a relative path that is wrong by two levels in
    // the prerender bundle: "Cannot find module .../packages/crouton-email/brand/
    // email-brand.mjs"). The deleted @fyit/crouton meta module masked this (#2290).
    externals: {
      inline: [fileURLToPath(new URL('./', import.meta.url))]
    },
    // Required for vue-email: enables Vue SFC compilation in server context
    // See: https://vuemail.net/getting-started/nuxt-nitro
    rollupConfig: {
      plugins: [vue() as any]
    }
  }
})
