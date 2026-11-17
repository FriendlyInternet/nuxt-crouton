/**
 * @crouton/auth Nuxt Module
 *
 * Entry point for the @crouton/auth Nuxt layer.
 * Wraps Better Auth with teams, billing, passkeys, and 2FA support.
 */
import {
  defineNuxtModule,
  addServerHandler,
  addImportsDir,
  createResolver,
  addComponentsDir,
  addServerPlugin,
  addPlugin
} from '@nuxt/kit'
import { defu } from 'defu'
import type { CroutonAuthConfig } from './types/config'

// Module meta
export const name = '@crouton/auth'
export const version = '0.1.0'

// Default configuration
const defaults: CroutonAuthConfig = {
  methods: {
    password: true,
    oauth: undefined,
    passkeys: false,
    twoFactor: false,
    magicLink: false,
    phone: false
  },
  teams: {
    // Team creation behavior
    autoCreateOnSignup: false,
    defaultTeamSlug: undefined,
    // Permissions
    allowCreate: true,
    limit: 0, // 0 = unlimited
    // UI display
    showSwitcher: true,
    showManagement: true,
    // Membership
    memberLimit: 100,
    requireInvite: true,
    invitationExpiry: 172800, // 48 hours
    requireEmailVerification: false,
    defaultRole: 'member'
  },
  ui: {
    theme: 'default',
    redirects: {
      afterLogin: '/',
      afterLogout: '/',
      afterRegister: '/',
      unauthenticated: '/auth/login',
      authenticated: '/'
    },
    showRememberMe: true,
    showSocialLogin: true,
    showGoHome: true,
    darkMode: true
  },
  session: {
    expiresIn: 604800, // 7 days
    cookieName: 'better-auth.session_token',
    sameSite: 'lax'
  },
  debug: false
}

/**
 * Validate the configuration
 */
function validateConfig(config: CroutonAuthConfig): void {
  const teams = config.teams ?? {}

  // Validate passkey config for production
  if (config.methods?.passkeys && typeof config.methods.passkeys === 'object') {
    if (!config.methods.passkeys.rpId) {
      console.warn(
        `[${name}] Passkeys enabled but rpId not set. Will use current domain in production.`
      )
    }
  }

  // Warn about conflicting team creation settings
  if (teams.autoCreateOnSignup && teams.defaultTeamSlug) {
    console.warn(
      `[${name}] Both autoCreateOnSignup and defaultTeamSlug are set. ` +
      `autoCreateOnSignup will create a personal workspace AND user will be added to the default team.`
    )
  }

  // Info about team creation behavior
  if (teams.autoCreateOnSignup) {
    console.info(
      `[${name}] autoCreateOnSignup enabled: Each new user will get their own workspace.`
    )
  }

  if (teams.defaultTeamSlug) {
    console.info(
      `[${name}] defaultTeamSlug set: Every user joins team "${teams.defaultTeamSlug}" on sign-up and sign-in.`
    )
  }
}

export default defineNuxtModule<CroutonAuthConfig>({
  meta: {
    name,
    version,
    configKey: 'croutonAuth',
    compatibility: {
      nuxt: '^3.14.0 || ^4.0.0'
    }
  },

  defaults,

  async setup(moduleConfig, nuxt) {
    const resolver = createResolver(import.meta.url)

    // Merge config with defaults
    const config = defu(moduleConfig, defaults)

    // Validate configuration
    validateConfig(config)

    // Set runtime config
    // Use spread to preserve other crouton properties while ensuring auth config takes priority
    // (defu preserves existing values, but we want the module's resolved config to win)
    nuxt.options.runtimeConfig.public.crouton = {
      ...nuxt.options.runtimeConfig.public.crouton,
      auth: config
    } as typeof nuxt.options.runtimeConfig.public.crouton

    // Register server-side auth secret
    nuxt.options.runtimeConfig.auth = defu(nuxt.options.runtimeConfig.auth, {
      secret: process.env.BETTER_AUTH_SECRET || '',
      baseUrl: process.env.BETTER_AUTH_URL || ''
    })

    // Add composables
    addImportsDir(resolver.resolve('./app/composables'))

    // Add utils (error handling, etc.)
    addImportsDir(resolver.resolve('./app/utils'))

    // Add components with performance optimizations
    // Core components (loaded eagerly)
    addComponentsDir({
      path: resolver.resolve('./app/components/Auth'),
      pathPrefix: false,
      prefix: 'Auth',
      global: false
    })

    addComponentsDir({
      path: resolver.resolve('./app/components/Sidebar'),
      pathPrefix: false,
      prefix: '',
      global: false
    })

    addComponentsDir({
      path: resolver.resolve('./app/components/Loading'),
      pathPrefix: false,
      prefix: '',
      global: false
    })

    addComponentsDir({
      path: resolver.resolve('./app/components/Error'),
      pathPrefix: false,
      prefix: '',
      global: false
    })

    // Non-critical components (can be lazy loaded by user)
    addComponentsDir({
      path: resolver.resolve('./app/components/Account'),
      pathPrefix: false,
      prefix: 'Account',
      global: false
    })

    addComponentsDir({
      path: resolver.resolve('./app/components/Team'),
      pathPrefix: false,
      prefix: 'Team',
      global: true // Global so TeamSwitcher is available in dashboard layout
    })

    // Add server utilities
    nuxt.options.nitro = defu(nuxt.options.nitro, {
      imports: {
        dirs: [resolver.resolve('./server/utils')]
      }
    })

    // Add auth API handler
    addServerHandler({
      route: '/api/auth/**',
      handler: resolver.resolve('./server/api/auth/[...all]')
    })

    // Add server plugins
    addServerPlugin(resolver.resolve('./server/plugins/auth-init'))

    // Add team initialization plugin if auto-creating workspaces or using default team
    if (config.teams?.autoCreateOnSignup || config.teams?.defaultTeamSlug) {
      addServerPlugin(resolver.resolve('./server/plugins/team-init'))
    }

    // Note: Route middleware is auto-discovered from app/middleware/ when used as a layer
    // No need to call addRouteMiddleware() since files exist:
    // - app/middleware/auth.ts
    // - app/middleware/guest.ts
    // - app/middleware/team-context.global.ts (global middleware via .global suffix)

    // Add client-side plugin
    addPlugin({
      src: resolver.resolve('./app/plugins/auth-client.client'),
      mode: 'client'
    })

    // Add team context plugin (for collection integration)
    addPlugin({
      src: resolver.resolve('./app/plugins/team-context'),
      mode: 'all'
    })

    // Add CSS assets
    nuxt.options.css.push(resolver.resolve('./app/assets/css/auth.css'))

    // Transpile the module
    nuxt.options.build.transpile.push(resolver.resolve('./'))

    // Log setup complete
    if (config.debug) {
      const teams = config.teams ?? {}
      console.log(`[${name}] Module setup complete`)
      console.log(`[${name}] Team config:`, {
        autoCreateOnSignup: teams.autoCreateOnSignup,
        defaultTeamSlug: teams.defaultTeamSlug,
        allowCreate: teams.allowCreate,
        showSwitcher: teams.showSwitcher
      })
      console.log(`[${name}] Auth methods:`, Object.keys(config.methods || {}).filter(k => config.methods?.[k as keyof typeof config.methods]))
    }
  }
})

// Re-export types
export type { CroutonAuthConfig } from './types/config'
