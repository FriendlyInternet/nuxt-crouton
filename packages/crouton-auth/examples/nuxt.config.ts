/**
 * @crouton/auth Configuration Examples
 *
 * This file shows different configuration patterns using the flag-based approach.
 * URLs always include [team] param (industry standard: Linear, Notion, Vercel, GitHub).
 *
 * The `mode` property has been removed in favor of composable flags in `teams` config.
 */

// =============================================================================
// Pattern 1: Multi-Tenant SaaS
// Users can create and join multiple organizations
// =============================================================================
export const multiTenantConfig = {
  croutonAuth: {
    // Team configuration - users can create/join multiple teams
    teams: {
      allowCreate: true, // Users can create new teams
      showSwitcher: true, // Show team switcher in UI
      showManagement: true, // Show team management settings
      limit: 5, // Max 5 teams per user (0 = unlimited)
      memberLimit: 50,
      requireInvite: true,
      defaultRole: 'member'
    },

    // Authentication methods
    methods: {
      password: {
        enabled: true,
        minLength: 8
      },
      oauth: {
        github: {
          clientId: process.env.GITHUB_CLIENT_ID!,
          clientSecret: process.env.GITHUB_CLIENT_SECRET!
        },
        google: {
          clientId: process.env.GOOGLE_CLIENT_ID!,
          clientSecret: process.env.GOOGLE_CLIENT_SECRET!
        }
      },
      passkeys: true,
      twoFactor: {
        enabled: true,
        backupCodesCount: 10
      }
    },

    // Organization-based billing (always)
    billing: {
      enabled: true,
      stripe: {
        publishableKey: process.env.STRIPE_PUBLISHABLE_KEY!,
        secretKey: process.env.STRIPE_SECRET_KEY!,
        webhookSecret: process.env.STRIPE_WEBHOOK_SECRET!,
        trialDays: 14,
        plans: [
          {
            id: 'free',
            name: 'Free',
            description: 'For individuals getting started',
            stripePriceId: 'price_free',
            price: 0,
            interval: 'month',
            features: ['3 projects', '1 team member', 'Basic support']
          },
          {
            id: 'pro',
            name: 'Pro',
            description: 'For growing teams',
            stripePriceId: 'price_pro_monthly',
            price: 29,
            interval: 'month',
            features: ['Unlimited projects', '10 team members', 'Priority support']
          }
        ]
      }
    }
  }
}

// =============================================================================
// Pattern 2: Single-Tenant Team App
// One default organization, all users join on sign-up and sign-in
// =============================================================================
export const singleTenantConfig = {
  croutonAuth: {
    // App name (used as default organization name)
    appName: 'Acme Corporation',

    // Team configuration - everyone joins the default team
    teams: {
      defaultTeamSlug: 'acme-corp', // All users join this team on sign-up and sign-in
      allowCreate: false, // Users cannot create new teams
      showSwitcher: false, // Hide team switcher (only one team)
      showManagement: true, // Still show team settings for admins
      memberLimit: 500
    },

    // Authentication methods (stricter for internal app)
    methods: {
      password: {
        enabled: true,
        minLength: 12,
        requireUppercase: true,
        requireNumbers: true
      },
      passkeys: true,
      twoFactor: {
        enabled: true,
        backupCodesCount: 10
      }
    },

    // Billing disabled for internal team app
    billing: {
      enabled: false
    }
  }
}

// =============================================================================
// Pattern 3: Personal Workspace
// Auto-create personal workspace for each user on signup
// =============================================================================
export const personalConfig = {
  croutonAuth: {
    // App name (used in personal workspace naming)
    appName: 'My Notes App',

    // Team configuration - personal workspace per user
    teams: {
      autoCreateOnSignup: true, // Auto-create personal workspace on signup
      allowCreate: false, // Users cannot create additional teams
      showSwitcher: false, // Hide team switcher (personal workspace only)
      showManagement: false // Hide team management (personal = single user)
    },

    // Authentication methods
    methods: {
      password: true,
      oauth: {
        google: {
          clientId: process.env.GOOGLE_CLIENT_ID!,
          clientSecret: process.env.GOOGLE_CLIENT_SECRET!
        }
      },
      magicLink: {
        enabled: true,
        expiresIn: 600
      },
      passkeys: true,
      twoFactor: false
    },

    // Organization-based billing (personal workspace = org with 1 member)
    billing: {
      enabled: true,
      stripe: {
        publishableKey: process.env.STRIPE_PUBLISHABLE_KEY!,
        secretKey: process.env.STRIPE_SECRET_KEY!,
        webhookSecret: process.env.STRIPE_WEBHOOK_SECRET!,
        trialDays: 14,
        plans: [
          {
            id: 'free',
            name: 'Free',
            description: 'Get started for free',
            stripePriceId: 'price_free',
            price: 0,
            interval: 'month',
            features: ['100 notes', 'Basic features', 'Mobile app']
          },
          {
            id: 'premium',
            name: 'Premium',
            description: 'Unlock all features',
            stripePriceId: 'price_premium_monthly',
            price: 9,
            interval: 'month',
            features: ['Unlimited notes', 'Advanced editor', 'Priority support']
          }
        ]
      }
    }
  }
}

// =============================================================================
// Configuration Reference
// =============================================================================
/**
 * TeamsConfig flags:
 *
 * | Flag | Purpose | Default |
 * |------|---------|---------|
 * | autoCreateOnSignup | Auto-create personal workspace on signup | false |
 * | defaultTeamSlug | Everyone joins this team on sign-up and sign-in | undefined |
 * | allowCreate | Can users create additional teams | true |
 * | showSwitcher | Show team switcher UI | true |
 * | showManagement | Show team management UI | true |
 * | limit | Max teams per user (0 = unlimited) | 0 |
 *
 * Migration from old modes:
 *
 * | Old Mode | New Configuration |
 * |----------|-------------------|
 * | multi-tenant | { teams: { allowCreate: true, showSwitcher: true } } |
 * | single-tenant | { teams: { defaultTeamSlug: 'acme', allowCreate: false, showSwitcher: false } } |
 * | personal | { teams: { autoCreateOnSignup: true, allowCreate: false, showSwitcher: false } } |
 */

// =============================================================================
// Actual nuxt.config.ts (pick one pattern)
// =============================================================================
export default defineNuxtConfig({
  extends: ['@crouton/auth'],

  hub: {
    db: 'sqlite' // Use db: 'sqlite' for local dev, NOT database: true
  },

  // Use one of the patterns above:
  // croutonAuth: multiTenantConfig.croutonAuth
  // croutonAuth: singleTenantConfig.croutonAuth
  // croutonAuth: personalConfig.croutonAuth

  croutonAuth: {
    // Start with multi-tenant pattern (most common)
    teams: {
      allowCreate: true,
      showSwitcher: true,
      showManagement: true
    },

    methods: {
      password: true,
      passkeys: true,
      twoFactor: {
        enabled: true
      }
    },

    ui: {
      redirects: {
        afterLogin: '/',
        afterLogout: '/',
        afterRegister: '/'
      }
    }
  }
})
