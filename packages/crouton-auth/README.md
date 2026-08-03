# @crouton/auth

Authentication layer for Nuxt applications powered by [Better Auth](https://better-auth.com). Provides teams/organizations, billing (Stripe), passkeys (WebAuthn), 2FA, and OAuth support.

## Features

- **Authentication** - Email/password, OAuth (GitHub, Google, Discord), passkeys (WebAuthn), 2FA (TOTP), magic links
- **Teams/Organizations** - Full team management via Better Auth's Organization plugin
- **Billing** - Subscription management via Better Auth's Stripe plugin
- **Three Modes** - Multi-tenant SaaS, single-tenant app, personal workspace
- **Pre-built Components** - Login forms, team management, billing UI
- **Server Utilities** - Authorization helpers for API routes

## Table of Contents

- [Installation](#installation)
- [Quick Start](#quick-start)
- [Operational Modes](#operational-modes)
- [Configuration Reference](#configuration-reference)
- [Composables](#composables)
- [Components](#components)
- [Server Utilities](#server-utilities)
- [Middleware](#middleware)
- [Database Setup](#database-setup)
- [Examples](#examples)

---

## Installation

```bash
pnpm add @crouton/auth
```

## Quick Start

### 1. Add to your Nuxt config

```typescript
// nuxt.config.ts
export default defineNuxtConfig({
  extends: ['@crouton/auth'],

  croutonAuth: {
    mode: 'multi-tenant', // 'multi-tenant' | 'single-tenant' | 'personal'
    methods: {
      password: true,
      oauth: {
        github: {
          clientId: process.env.GITHUB_CLIENT_ID!,
          clientSecret: process.env.GITHUB_CLIENT_SECRET!
        }
      },
      passkeys: true,
      twoFactor: true
    }
  }
})
```

### 2. Set environment variables

```bash
# .env
# Required
BETTER_AUTH_SECRET=your-secret-key-min-32-chars
BETTER_AUTH_URL=http://localhost:3000

# OAuth (optional, per provider)
GITHUB_CLIENT_ID=
GITHUB_CLIENT_SECRET=
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=

# Billing (optional)
STRIPE_SECRET_KEY=
STRIPE_PUBLISHABLE_KEY=
STRIPE_WEBHOOK_SECRET=
```

### 3. Export auth schema

```typescript
// server/database/schema/index.ts
export * from '@crouton/auth/server/database/schema/auth'
```

### 4. Use in your components

```vue
<script setup lang="ts">
const { user, loggedIn, login, logout } = useAuth()
const { currentTeam, teams, switchTeam } = useTeam()

async function handleLogin() {
  await login({ email: 'user@example.com', password: 'password' })
}
</script>

<template>
  <div v-if="loggedIn">
    <p>Welcome, {{ user?.name }}</p>
    <p>Current team: {{ currentTeam?.name }}</p>
    <button @click="logout">Logout</button>
  </div>
  <div v-else>
    <AuthLoginForm />
  </div>
</template>
```

---

## Operational Modes

### Multi-Tenant

Users can create and join multiple organizations. Ideal for SaaS applications.

```typescript
croutonAuth: {
  mode: 'multi-tenant',
  teams: {
    allowCreate: true,
    limit: 5,           // Max teams per user
    memberLimit: 100    // Max members per team
  }
}
```

**URL Structure**: `/[team-slug]/...`

### Single-Tenant

One organization with multiple users. Ideal for team/company applications.

```typescript
croutonAuth: {
  mode: 'single-tenant',
  appName: 'Acme Corp',        // Default team name
  defaultTeamId: 'acme-corp'   // Auto-created on first boot
}
```

**URL Structure**: `/[team-slug]/...` (team auto-resolved)

### Personal

One organization per user. Ideal for personal productivity applications.

```typescript
croutonAuth: {
  mode: 'personal'
}
```

**URL Structure**: `/[team-slug]/...` (personal team auto-created)

---

## Configuration Reference

### Full Configuration Interface

```typescript
interface CroutonAuthConfig {
  // Authentication mode
  mode: 'multi-tenant' | 'single-tenant' | 'personal'

  // Default team for single-tenant mode
  defaultTeamId?: string
  appName?: string

  // Authentication methods
  methods?: {
    // Email/password
    password?: boolean | {
      enabled?: boolean
      minLength?: number              // Default: 8
      requireUppercase?: boolean
      requireLowercase?: boolean
      requireNumbers?: boolean
      requireSpecialChars?: boolean
      resetEnabled?: boolean          // Default: true
    }

    // OAuth providers
    oauth?: {
      github?: { clientId: string, clientSecret: string, scopes?: string[] }
      google?: { clientId: string, clientSecret: string, scopes?: string[] }
      discord?: { clientId: string, clientSecret: string, scopes?: string[] }
    }

    // Passkeys (WebAuthn)
    passkeys?: boolean | {
      enabled?: boolean
      rpId?: string                   // Domain without protocol
      rpName?: string                 // Human-readable app name
      conditionalUI?: boolean         // Default: true
    }

    // Two-factor authentication
    twoFactor?: boolean | {
      enabled?: boolean
      totp?: boolean                  // Default: true
      backupCodesCount?: number       // Default: 10
      trustedDevices?: boolean        // Default: true
      trustedDeviceExpiry?: number    // Days, default: 30
      issuer?: string                 // Shown in authenticator apps
    }

    // Magic link
    magicLink?: boolean | {
      enabled?: boolean
      expiresIn?: number              // Seconds, default: 300
    }
  }

  // Team configuration
  teams?: {
    allowCreate?: boolean             // Default: true (multi-tenant)
    limit?: number                    // Max teams per user, default: 5
    memberLimit?: number              // Max members per team, default: 100
    requireInvite?: boolean           // Default: true
    invitationExpiry?: number         // Seconds, default: 172800 (48h)
    defaultRole?: 'member' | 'admin'  // Default: 'member'
  }

  // Billing (Stripe)
  billing?: {
    enabled?: boolean
    provider?: 'stripe'
    stripe?: {
      publishableKey: string
      secretKey: string
      webhookSecret: string
      plans?: Array<{
        id: string
        name: string
        description?: string
        stripePriceId: string
        price: number
        currency?: string             // Default: 'usd'
        interval: 'month' | 'year'
        features?: string[]
      }>
      trialDays?: number              // Default: 0
      customerPortal?: boolean        // Default: true
    }
  }

  // UI configuration
  ui?: {
    theme?: 'default' | 'minimal'
    redirects?: {
      afterLogin?: string             // Default: '/'
      afterLogout?: string            // Default: '/'
      afterRegister?: string          // Default: '/'
      unauthenticated?: string        // Default: '/auth/login'
      authenticated?: string          // Default: '/'
    }
    showRememberMe?: boolean          // Default: true
    showSocialLogin?: boolean         // Default: true
    darkMode?: boolean                // Default: true
  }

  // Session configuration
  session?: {
    expiresIn?: number                // Seconds, default: 604800 (7 days)
    updateAge?: number
    cookieName?: string               // Default: 'better-auth.session_token'
    secure?: boolean                  // Default: true in production
    sameSite?: 'strict' | 'lax' | 'none'
  }

  debug?: boolean                     // Enable verbose logging
}
```

---

## Composables

### useAuth()

Main authentication composable for login, registration, and auth method management.

```typescript
const {
  // State
  user,                    // Ref<User | null>
  loading,                 // Ref<boolean>
  error,                   // Ref<string | null>
  isPending,               // From session — a resolved-latch, see useSession()
  sessionError,            // Session error

  // Computed
  loggedIn,                // ComputedRef<boolean>

  // Capability flags
  hasPassword,             // ComputedRef<boolean>
  hasOAuth,                // ComputedRef<boolean>
  hasPasskeys,             // ComputedRef<boolean>
  has2FA,                  // ComputedRef<boolean>
  hasMagicLink,            // ComputedRef<boolean>
  oauthProviders,          // ComputedRef<string[]>

  // Auth methods
  login,                   // (credentials: LoginCredentials) => Promise<void>
  loginWithOAuth,          // (provider: string) => Promise<void>
  loginWithPasskey,        // () => Promise<void>
  loginWithPasskeyAutofill,// () => Promise<void>
  loginWithMagicLink,      // (email: string) => Promise<void>
  register,                // (data: RegisterData) => Promise<void>
  logout,                  // () => Promise<void>
  forgotPassword,          // (email: string) => Promise<void>
  resetPassword,           // (token: string, password: string) => Promise<void>

  // Session methods
  refreshSession,          // () => Promise<void>

  // Passkey management
  addPasskey,              // (options?: AddPasskeyOptions) => Promise<void>
  listPasskeys,            // () => Promise<PasskeyInfo[]>
  deletePasskey,           // (id: string) => Promise<void>
  isWebAuthnSupported,     // () => boolean
  isConditionalUIAvailable,// () => Promise<boolean>

  // Two-Factor Authentication
  enable2FA,               // (password: string) => Promise<TotpSetupData>
  disable2FA,              // (password: string) => Promise<void>
  getTotpUri,              // () => Promise<string>
  verifyTotp,              // (options: VerifyTotpOptions) => Promise<boolean>
  generateBackupCodes,     // (password: string) => Promise<string[]>
  viewBackupCodes,         // (password: string) => Promise<BackupCodeInfo[]>
  verifyBackupCode,        // (code: string) => Promise<boolean>
  get2FAStatus,            // () => Promise<TwoFactorStatus>
} = useAuth()
```

**Example: Login with error handling**

```vue
<script setup lang="ts">
const { login, loginWithOAuth, error, loading } = useAuth()

const credentials = ref({ email: '', password: '' })

async function handleLogin() {
  try {
    await login(credentials.value)
    navigateTo('/')
  } catch (e) {
    // error.value is automatically set
  }
}
</script>

<template>
  <form @submit.prevent="handleLogin">
    <input v-model="credentials.email" type="email" />
    <input v-model="credentials.password" type="password" />
    <p v-if="error" class="text-red-500">{{ error }}</p>
    <button type="submit" :disabled="loading">
      {{ loading ? 'Logging in...' : 'Login' }}
    </button>
    <button type="button" @click="loginWithOAuth('github')">
      Login with GitHub
    </button>
  </form>
</template>
```

---

### useSession()

Low-level session management with reactive access to session data.

```typescript
const {
  // Raw data
  data,                    // Raw session data

  // Computed accessors
  session,                 // Ref<Session | null>
  user,                    // Ref<User | null>
  activeOrganization,      // Ref<Team | null>

  // Status
  isPending,               // Ref<boolean> — see below
  error,                   // Ref<Error | null>
  isAuthenticated,         // ComputedRef<boolean>

  // Methods
  refresh,                 // () => Promise<void>
  clear,                   // () => Promise<void>
} = useSession()
```

#### `isPending` is a resolved-latch, not an in-flight flag

It starts `true` and flips to `false` the first time the session resolves — then **never
returns to `true`**. Read it as *"do we know who the user is yet?"*, not *"is a request in
flight right now?"*.

Use it to hold a decision until auth is known (route guards, redirects). Do **not** use it
to drive a loading spinner on a refresh — it will not go back to `true` for background
revalidation, and a UI that waits for that will wait forever.

This changed in #1703. Previously it flipped on every fetch, including background
revalidation triggered by better-auth's `$sessionSignal`. Because every consumer in the
monorepo already treated it as a latch, that churn re-armed all of them at once — enough to
restart an in-flight navigation and strand a user on a spinner.

`clear()` (logout) tears down the session state, the in-flight request caches and the
default-org repair latch, so the next user on a shared device starts clean.

---

### useTeam()

Team (organization) management with mode-aware behavior.

```typescript
const {
  // State
  currentTeam,             // ComputedRef<Team | null>
  teams,                   // ComputedRef<Team[]> — populated by refreshTeams() / SSR, NOT
                           // by better-auth's useListOrganizations atom (#1703)
  members,                 // ComputedRef<Member[]>
  currentRole,             // ComputedRef<MemberRole | null>
  loading,                 // Ref<boolean>
  error,                   // Ref<string | null>

  // Mode-aware flags
  showTeamSwitcher,        // ComputedRef<boolean> - true if multi-tenant + >1 team
  showTeamManagement,      // ComputedRef<boolean> - true if multi-tenant
  canCreateTeam,           // ComputedRef<boolean>
  canInviteMembers,        // ComputedRef<boolean>
  canManageMembers,        // ComputedRef<boolean>
  isOwner,                 // ComputedRef<boolean>
  isAdmin,                 // ComputedRef<boolean>

  // Team methods
  switchTeam,              // (teamId: string) => Promise<void>
  switchTeamBySlug,        // (slug: string) => Promise<void>
  createTeam,              // (data: CreateTeamData) => Promise<Team>
  updateTeam,              // (data: UpdateTeamData) => Promise<Team>
  deleteTeam,              // () => Promise<void>

  // Member methods
  loadMembers,             // () => Promise<void>
  inviteMember,            // (data: InviteMemberData) => Promise<void>
  removeMember,            // (userId: string) => Promise<void>
  updateMemberRole,        // (userId: string, role: MemberRole) => Promise<void>
  leaveTeam,               // () => Promise<void>

  // Invitation methods
  getPendingInvitations,   // () => Promise<Invitation[]>
  cancelInvitation,        // (invitationId: string) => Promise<void>
  acceptInvitation,        // (invitationId: string) => Promise<void>
  rejectInvitation,        // (invitationId: string) => Promise<void>
} = useTeam()
```

**Example: Team switcher**

```vue
<script setup lang="ts">
const { teams, currentTeam, switchTeam, showTeamSwitcher } = useTeam()
</script>

<template>
  <div v-if="showTeamSwitcher">
    <select
      :value="currentTeam?.id"
      @change="switchTeam(($event.target as HTMLSelectElement).value)"
    >
      <option v-for="team in teams" :key="team.id" :value="team.id">
        {{ team.name }}
      </option>
    </select>
  </div>
</template>
```

---

### useTeamContext()

Mode-aware team context resolution for URL building and navigation.

```typescript
const {
  // Core values
  teamId,                  // ComputedRef<string | null>
  teamSlug,                // ComputedRef<string | null>
  team,                    // Full team object

  // State
  hasTeamContext,          // ComputedRef<boolean>
  useTeamInUrl,            // ComputedRef<boolean> - true if multi-tenant
  isTeamRoute,             // ComputedRef<boolean>
  routeTeamParam,          // ComputedRef<string | undefined>
  isTeamSynced,            // URL team matches session
  isResolved,              // Ref<boolean>
  hasError,                // Ref<boolean>
  error,                   // Ref<string | null>

  // URL builders
  buildDashboardUrl,       // (path: string, teamSlug?: string) => string
  buildApiUrl,             // (path: string, teamId?: string) => string

  // Actions
  resolveTeamFromRoute,    // () => Promise<TeamContextResolution>
  navigateToTeamRoute,     // (path: string, teamSlug?: string) => Promise<void>
} = useTeamContext()
```

**Example: Mode-aware URL building**

```vue
<script setup lang="ts">
const { buildAdminUrl, buildApiUrl, teamId } = useTeamContext()

// Multi-tenant: /admin/acme/settings
// Single-tenant: /admin/settings
const settingsUrl = buildAdminUrl('/settings')

// Fetch team-scoped data
const { data } = await useFetch(buildApiUrl('/bookings'))
</script>
```

---

### useBilling()

Subscription and billing management with Stripe integration.

```typescript
const {
  // State
  enabled,                 // ComputedRef<boolean>
  subscription,            // Ref<Subscription | null>
  subscriptions,           // Ref<Subscription[]>
  plan,                    // Ref<Plan | null>
  plans,                   // Ref<Plan[]>
  loading,                 // Ref<boolean>
  error,                   // Ref<string | null>

  // Status computed
  status,                  // ComputedRef<SubscriptionStatus | null>
  billingMode,             // 'user' | 'organization'
  isPro,                   // ComputedRef<boolean> - active or trialing
  isTrialing,              // ComputedRef<boolean>
  isCanceled,              // ComputedRef<boolean>
  isPastDue,               // ComputedRef<boolean>
  trialEndsAt,             // ComputedRef<Date | null>
  currentPeriodEnd,        // ComputedRef<Date | null>
  cancelAtPeriodEnd,       // ComputedRef<boolean>

  // Methods
  fetchSubscriptions,      // (referenceId?: string) => Promise<void>
  checkout,                // (planId: string, options?: CheckoutOptions) => Promise<void>
  portal,                  // (options?: PortalOptions) => Promise<void>
  cancel,                  // (subscriptionId?: string) => Promise<void>
  restore,                 // (subscriptionId?: string) => Promise<void>
  changePlan,              // (newPlanId: string, options?: CheckoutOptions) => Promise<void>

  // Helpers
  isCurrentPlan,           // (planId: string) => boolean
  getPlan,                 // (planId: string) => Plan | undefined
} = useBilling()
```

**Example: Pricing page**

```vue
<script setup lang="ts">
const { plans, isPro, checkout, loading } = useBilling()

async function handleUpgrade(planId: string) {
  await checkout(planId, {
    successUrl: '/?upgraded=true',
    cancelUrl: '/pricing'
  })
}
</script>

<template>
  <div class="grid grid-cols-3 gap-4">
    <div v-for="plan in plans" :key="plan.id" class="p-4 border rounded">
      <h3>{{ plan.name }}</h3>
      <p>${{ plan.price }}/{{ plan.interval }}</p>
      <ul>
        <li v-for="feature in plan.features" :key="feature">{{ feature }}</li>
      </ul>
      <button
        @click="handleUpgrade(plan.id)"
        :disabled="loading || isPro"
      >
        {{ isPro ? 'Current Plan' : 'Upgrade' }}
      </button>
    </div>
  </div>
</template>
```

---

## Components

### Auth Components

| Component | Description |
|-----------|-------------|
| `AuthLoginForm` | Complete login form with email/password and OAuth |
| `AuthRegisterForm` | Registration form with validation |
| `AuthForgotPasswordForm` | Password reset request form |
| `AuthOAuthButtons` | Social login buttons based on config |
| `AuthPasskeyButton` | Passkey login button |
| `AuthMagicLinkForm` | Magic link login form |
| `AuthTwoFactorForm` | 2FA verification form |

### Account Components

| Component | Description |
|-----------|-------------|
| `AccountProfileForm` | Edit user profile (name, avatar) |
| `AccountPasswordForm` | Change password form |
| `AccountSettings` | Combined account settings page |
| `AccountTwoFactorSetup` | 2FA setup wizard with QR code |
| `AccountPasskeyManager` | Manage registered passkeys |
| `AccountLinkedAccounts` | View/manage OAuth connections |
| `AccountDeleteAccount` | Account deletion with confirmation |

### Team Components

| Component | Description |
|-----------|-------------|
| `TeamCreateForm` | Create new team form |
| `TeamSwitcher` | Team selection dropdown |
| `TeamSettings` | Team settings (name, logo, etc.) |
| `TeamMembers` | Team members list |
| `TeamMemberRow` | Individual member row with actions |
| `TeamMemberInviteForm` | Invite new member form |
| `TeamInvitations` | Pending invitations list |
| `TeamDeleteConfirm` | Team deletion confirmation |

### Billing Components

| Component | Description |
|-----------|-------------|
| `BillingCurrentPlan` | Display current subscription |
| `BillingPlanCard` | Individual plan card |
| `BillingPricingTable` | Full pricing comparison table |
| `BillingUpgradeButton` | Upgrade CTA button |
| `BillingPortalButton` | Stripe portal access button |
| `BillingUsageDisplay` | Usage metrics display |

### Sidebar Components

| Component | Description |
|-----------|-------------|
| `SidebarAuthSidebar` | Complete auth sidebar |
| `SidebarTeamSection` | Team section with switcher |
| `SidebarUserMenu` | User menu with profile/logout |

---

## Server Utilities

### Team Auth Connector (`#crouton/team-auth`)

The connector provides authorization helpers for API routes.

**Setup in nuxt.config.ts:**

```typescript
export default defineNuxtConfig({
  nitro: {
    alias: {
      '#crouton/team-auth': '@crouton/auth/server/utils/team-auth'
    }
  }
})
```

### Authorization Helpers

```typescript
import {
  resolveTeamAndCheckMembership,
  requireTeamRole,
  requireTeamAdmin,
  requireTeamOwner,
  getMembership,
  getTeamById,
  getTeamBySlug,
  getUserTeams,
  canUserCreateTeam,
  isTeamMemberWithEvent,
} from '#crouton/team-auth'

// In API routes
export default defineEventHandler(async (event) => {
  // Get team context with membership check
  const { team, member, user } = await resolveTeamAndCheckMembership(event)
  // team: Organization object
  // member: Membership with role
  // user: Authenticated user

  // Require specific role (throws 403 if not authorized)
  await requireTeamRole(event, 'admin')  // admin or owner
  await requireTeamAdmin(event)          // Shorthand for admin+
  await requireTeamOwner(event)          // Owner only

  // Query functions
  const team = await getTeamById(event, teamId)
  const team = await getTeamBySlug(event, 'acme')
  const teams = await getUserTeams(event, userId)
  const membership = await getMembership(event, teamId, userId)
  const canCreate = await canUserCreateTeam(event, userId)
})
```

### Example: Protected Team API

```typescript
// server/api/teams/[teamId]/projects.get.ts
import { resolveTeamAndCheckMembership } from '#crouton/team-auth'

export default defineEventHandler(async (event) => {
  // Automatically validates:
  // 1. User is authenticated
  // 2. User is a member of the team
  const { team, member, user } = await resolveTeamAndCheckMembership(event)

  // Fetch projects for this team
  const projects = await db.query.projects.findMany({
    where: eq(schema.projects.teamId, team.id)
  })

  return projects
})
```

### Example: Admin-only endpoint

```typescript
// server/api/teams/[teamId]/settings.put.ts
import { requireTeamAdmin } from '#crouton/team-auth'

export default defineEventHandler(async (event) => {
  // Only admins and owners can update settings
  const { team, user } = await requireTeamAdmin(event)

  const body = await readBody(event)

  // Update team settings...
  return { success: true }
})
```

---

## Middleware

### `auth` Middleware

Requires authentication. Redirects to login if not authenticated.

```vue
<script setup lang="ts">
definePageMeta({
  middleware: 'auth'
})
</script>
```

### `guest` Middleware

Requires NO authentication. Redirects to home if authenticated.

```vue
<script setup lang="ts">
// pages/auth/login.vue
definePageMeta({
  middleware: 'guest'
})
</script>
```

### `team-context.global` Middleware

Global middleware that resolves team context from URL and syncs with session. Runs automatically on all routes.

---

## Database Setup

### Export Schema

```typescript
// server/database/schema/index.ts
export * from '@crouton/auth/server/database/schema/auth'
```

### Tables Created

| Table | Description |
|-------|-------------|
| `user` | User accounts |
| `session` | Active sessions |
| `account` | OAuth linked accounts |
| `verification` | Email verification tokens |
| `organization` | Teams/organizations |
| `member` | Organization memberships |
| `invitation` | Pending invitations |
| `passkey` | WebAuthn credentials |
| `twoFactor` | 2FA settings |
| `subscription` | Stripe subscriptions |

### Generate Migrations

```bash
npx drizzle-kit generate
```

### Apply Migrations

```bash
# Local development (NuxtHub auto-applies)
npx nuxt dev

# Or manually push
npx drizzle-kit push
```

---

## Examples

### Multi-Tenant SaaS

```typescript
// nuxt.config.ts
export default defineNuxtConfig({
  extends: ['@crouton/auth'],

  croutonAuth: {
    mode: 'multi-tenant',
    methods: {
      password: true,
      oauth: {
        google: {
          clientId: process.env.GOOGLE_CLIENT_ID!,
          clientSecret: process.env.GOOGLE_CLIENT_SECRET!
        },
        github: {
          clientId: process.env.GITHUB_CLIENT_ID!,
          clientSecret: process.env.GITHUB_CLIENT_SECRET!
        }
      },
      passkeys: true,
      twoFactor: true
    },
    teams: {
      allowCreate: true,
      limit: 5,
      memberLimit: 50
    },
    billing: {
      enabled: true,
      stripe: {
        publishableKey: process.env.STRIPE_PUBLISHABLE_KEY!,
        secretKey: process.env.STRIPE_SECRET_KEY!,
        webhookSecret: process.env.STRIPE_WEBHOOK_SECRET!,
        plans: [
          {
            id: 'free',
            name: 'Free',
            stripePriceId: 'price_free',
            price: 0,
            interval: 'month',
            features: ['5 projects', '1 team member']
          },
          {
            id: 'pro',
            name: 'Pro',
            stripePriceId: 'price_pro_monthly',
            price: 29,
            interval: 'month',
            features: ['Unlimited projects', '10 team members', 'Priority support']
          }
        ]
      }
    }
  }
})
```

### Single-Tenant Team App

```typescript
// nuxt.config.ts
export default defineNuxtConfig({
  extends: ['@crouton/auth'],

  croutonAuth: {
    mode: 'single-tenant',
    appName: 'Acme Corporation',
    defaultTeamId: 'acme',
    methods: {
      password: {
        enabled: true,
        minLength: 12,
        requireUppercase: true,
        requireNumbers: true
      },
      twoFactor: true
    },
    teams: {
      allowCreate: false,
      requireInvite: true
    }
  }
})
```

### Personal Productivity App

```typescript
// nuxt.config.ts
export default defineNuxtConfig({
  extends: ['@crouton/auth'],

  croutonAuth: {
    mode: 'personal',
    methods: {
      password: true,
      oauth: {
        google: {
          clientId: process.env.GOOGLE_CLIENT_ID!,
          clientSecret: process.env.GOOGLE_CLIENT_SECRET!
        }
      },
      magicLink: true
    },
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
            stripePriceId: 'price_free',
            price: 0,
            interval: 'month',
            features: ['Basic features']
          },
          {
            id: 'premium',
            name: 'Premium',
            stripePriceId: 'price_premium',
            price: 9,
            interval: 'month',
            features: ['All features', 'Priority support']
          }
        ]
      }
    }
  }
})
```

---

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `BETTER_AUTH_SECRET` | Yes | Session encryption key (min 32 chars) |
| `BETTER_AUTH_URL` | Yes | Application base URL |
| `GITHUB_CLIENT_ID` | OAuth | GitHub OAuth client ID |
| `GITHUB_CLIENT_SECRET` | OAuth | GitHub OAuth client secret |
| `GOOGLE_CLIENT_ID` | OAuth | Google OAuth client ID |
| `GOOGLE_CLIENT_SECRET` | OAuth | Google OAuth client secret |
| `DISCORD_CLIENT_ID` | OAuth | Discord OAuth client ID |
| `DISCORD_CLIENT_SECRET` | OAuth | Discord OAuth client secret |
| `STRIPE_PUBLISHABLE_KEY` | Billing | Stripe publishable key |
| `STRIPE_SECRET_KEY` | Billing | Stripe secret key |
| `STRIPE_WEBHOOK_SECRET` | Billing | Stripe webhook secret |

---

## TypeScript Types

```typescript
import type {
  User,
  Session,
  Team,
  Member,
  MemberRole,
  CroutonAuthConfig,
  AuthMode,
} from '@crouton/auth/types'
```

---

## Development

```bash
# Run tests
pnpm test

# Unit tests only
pnpm test:unit

# Integration tests
pnpm test:integration

# Type check
npx nuxt typecheck
```

---

## License

MIT
