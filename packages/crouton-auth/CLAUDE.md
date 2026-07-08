# CLAUDE.md - @crouton/auth

## Package Purpose

Authentication layer for Nuxt applications using Better Auth. Provides teams/organizations, passkeys (WebAuthn), 2FA, and OAuth support. This is the **canonical source** for team authentication in the nuxt-crouton ecosystem.

## Configuration Patterns

URLs always include `[team]` param (industry standard: Linear, Notion, Vercel, GitHub).

| Pattern | Configuration | Use Case |
|---------|---------------|----------|
| Team Creation | `teams: { allowCreate: true, showSwitcher: true }` | SaaS platforms |
| Default Team | `teams: { defaultTeamSlug: 'acme', allowCreate: false, showSwitcher: false }` | Company apps |
| Personal Workspace | `teams: { autoCreateOnSignup: true, allowCreate: false, showSwitcher: false }` | Personal apps |

### TeamsConfig Flags

| Flag | Purpose | Default |
|------|---------|---------|
| `autoCreateOnSignup` | Auto-create personal workspace on signup | false |
| `defaultTeamSlug` | Everyone joins this team on signup (first user → `owner`, rest → `member`) | undefined |
| `allowCreate` | Can users create additional teams | true |
| `showSwitcher` | Show team switcher UI | true |
| `showManagement` | Show team management UI | true |
| `limit` | Max teams per user (0 = unlimited) | 0 |

## Key Files

| File | Purpose |
|------|---------|
| `module.ts` | Nuxt module entry point |
| `nuxt.config.ts` | Layer configuration |
| `server/lib/auth.ts` | Better Auth factory (`createAuth`) |
| `server/utils/team-auth.ts` | Team auth utilities (exported via `@crouton/auth/server`) |
| `server/utils/team.ts` | Core team resolution logic |
| `types/config.ts` | `CroutonAuthConfig` configuration type |
| `types/connector.ts` | `BetterAuthConnector` interface |
| `app/utils/security.ts` | Client-side security utilities (public API for consumer apps) |
| `seed/index.ts` | Seed provider (`@fyit/crouton-auth/seed`) — upserts the team `organization`; optional staff user/account/member behind `--with-staff` |

## Public Utilities

`app/utils/security.ts` exports client-side helpers that are part of the **public API** for consumer apps. They are not used inside the monorepo itself but are deliberately available for import.

| Function | Signature | Purpose |
|----------|-----------|---------|
| `sanitizeEmail` | `(email: string) => string` | Lowercase + trim an email before storage or comparison |
| `isValidSlug` | `(slug: string) => boolean` | Validate team slug (3-50 chars, lowercase, hyphens, no leading/trailing hyphens) |
| `generateSlug` | `(text: string) => string` | Derive a valid slug from arbitrary text |
| `isValidTeamName` | `(name: string) => boolean` | Check team name length (2-100 chars) |
| `sanitizeRedirectUrl` | `(url: string) => string` | Allow only same-origin redirect URLs; returns `'/'` for external targets |
| `isSecureContext` | `() => boolean` | Return `true` when running over HTTPS (or SSR); wraps `window.isSecureContext` |

```typescript
// Consumer app usage
import { sanitizeEmail, generateSlug, isValidSlug, sanitizeRedirectUrl } from '@crouton/auth'

const slug = generateSlug('My Awesome Team')  // 'my-awesome-team'
const safeUrl = sanitizeRedirectUrl(redirectParam)  // '/' on external URLs
```

## Composables

| Composable | Purpose |
|------------|---------|
| `useAuth()` | Core auth (login, register, logout, OAuth, magic link) + capability flags |
| `usePasskeys()` | Passkey/WebAuthn management, login, browser support detection |
| `useTwoFactor()` | 2FA enable/disable, TOTP verification, backup codes |
| `usePasswordReset()` | Forgot password and reset flows |
| `useSession()` | Reactive session state |
| `useTeam()` | Team/organization management |
| `useTeamContext()` | Current team context |
| `useTeamState()` | Team state management |

## Components

### Auth Components
- `LoginForm`, `RegisterForm`, `ForgotPasswordForm`
- `OAuthButtons`, `PasskeyButton`, `MagicLinkForm`
- `TwoFactorForm`

### Account Components
- `ProfileForm`, `PasswordForm`, `Settings`
- `TwoFactorSetup`, `PasskeyManager`
- `LinkedAccounts`, `DeleteAccount`

### Team Components
- `CreateForm`, `Switcher`, `Settings`
- `Members`, `MemberRow`, `MemberInviteForm`
- `Invitations`, `DeleteConfirm`

### Admin Components
- `EmailLogs` — Auth email log viewer with stats, filtering, and error details

### Sidebar Components
- `AuthSidebar`, `TeamSection`, `UserMenu`

## Server Utilities

### Team Auth Functions (from `@crouton/auth/server`)

```typescript
// Preferred: Direct import from @crouton/auth/server
import { resolveTeamAndCheckMembership } from '@crouton/auth/server'

// In API handlers
export default defineEventHandler(async (event) => {
  const { team, member, user } = await resolveTeamAndCheckMembership(event)
  // team is the resolved organization
  // member is the user's membership
  // user is the authenticated user
})
```

### Authorization Helpers

```typescript
import { requireTeamMember, requireTeamAdmin, requireTeamOwner } from '@crouton/auth/server'

// Require specific roles
await requireTeamMember(event)  // Any team member
await requireTeamAdmin(event)   // Admin or owner
await requireTeamOwner(event)   // Owner only
```

### Public Team Resolution

```typescript
import { resolveTeamBySlugOrId } from '@crouton/auth/server'

// Resolve team by slug or ID without requiring authentication
// Used for public-facing endpoints (e.g., public collection API)
const { team } = await resolveTeamBySlugOrId(event)

// Custom route param name (default: 'id')
const { team } = await resolveTeamBySlugOrId(event, 'team')
```

### Query Functions

```typescript
import {
  getTeamById,
  getTeamBySlug,
  getUserTeams,
  isTeamMemberWithEvent,
  canUserCreateTeam,
  getOrganizationMembershipDirect
} from '@crouton/auth/server'
```

## Middleware

| Middleware | Purpose |
|------------|---------|
| `auth` | Requires authentication (redirect to login) |
| `guest` | Requires NO authentication (redirect to home) |
| `team-context.global` | Sets team context from route params |

## Configuration

```typescript
// nuxt.config.ts
export default defineNuxtConfig({
  modules: ['@crouton/auth'],

  croutonAuth: {
    // Team configuration (see Configuration Patterns above)
    teams: {
      allowCreate: true,     // Can create additional teams
      showSwitcher: true,    // Show team switcher UI
      showManagement: true,  // Show team management settings
      // autoCreateOnSignup: true,  // For personal workspace pattern
      // defaultTeamSlug: 'acme',   // For default team pattern
    },

    // Enable/disable features
    emailPassword: true,
    magicLink: false,
    passkeys: true,
    twoFactor: true,

    // OAuth providers
    oauth: {
      google: true,
      github: true
    }
  }
})
```

## Environment Variables

```bash
# Required
BETTER_AUTH_SECRET=your-secret-key
BETTER_AUTH_URL=http://localhost:3000

# Optional: extra trusted origins (comma-separated). The origin a request is
# actually served from is ALWAYS trusted automatically (createAuth passes
# trustedOrigins as a per-request function), so same-origin member login works
# on any host — custom domain, *.pages.dev preview, kassa.local — with no env
# var set. Use this only to trust *additional, cross-origin* callers (e.g. a
# separate front-end host hitting this API). Belt-and-suspenders, not required.
BETTER_AUTH_TRUSTED_ORIGINS=https://some-other-frontend.example.com

# OAuth (optional)
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GITHUB_CLIENT_ID=
GITHUB_CLIENT_SECRET=
```

## Database Schema

Located in `server/database/schema/auth.ts` (the `user` table itself lives in `schema/user.ts` so satellite tables like `user-profile.ts` can reference it without a circular import; `auth.ts` re-exports it):

- `user` - User accounts
- `session` - Active sessions
- `account` - OAuth linked accounts
- `verification` - Email verification tokens
- `organization` - Teams/organizations
- `member` - Organization memberships
- `invitation` - Pending invitations
- `passkey` - WebAuthn credentials
- `twoFactor` - 2FA settings
- `teamSettings` - Team-specific settings (translations, AI keys, theme)
- `authEmailLog` - Auth email audit log (verification, password reset, invitation, magic link)

### Auth Email Log API

| Endpoint | Method | Auth | Purpose |
|----------|--------|------|---------|
| `/api/teams/[id]/email-logs` | GET | Admin | List email logs (filter by `type`, `status`; paginate with `limit`, `offset`) |
| `/api/teams/[id]/email-logs/stats` | GET | Admin | Aggregate stats (total, sent, failed, pending, by type) |

Logs are scoped to team member email addresses. The `auth-email-logger` Nitro plugin automatically records every `crouton:auth:email` hook emission.

### Team Settings Table

The `teamSettings` table stores team-level configuration:

| Field | Type | Purpose |
|-------|------|---------|
| `translations` | JSON | Team-specific translation overrides by locale |
| `aiSettings` | JSON | AI API keys (Anthropic, OpenAI) - **server-only** |
| `themeSettings` | JSON | Visual theme (primary color, neutral color, radius) |

```typescript
// Theme settings type
interface TeamThemeSettings {
  preset?: 'custom' | 'blackandwhite' | 'ko'
  primary?: 'red' | 'orange' | ... | 'rose'  // Tailwind colors
  neutral?: 'slate' | 'gray' | 'zinc' | 'neutral' | 'stone'
  radius?: 0 | 0.125 | 0.25 | 0.375 | 0.5  // rem
  allowUserThemes?: boolean  // false = only admins can switch themes
}
```

## CLI Commands

```bash
# Database migrations
pnpm migrate:status    # Check migration status
pnpm migrate:generate  # Generate migrations
pnpm migrate:push      # Apply migrations
pnpm migrate:check     # Validate schema
pnpm migrate:reset     # Reset database

# Seeding
pnpm seed              # Seed all
pnpm seed:users        # Seed test users
pnpm seed:orgs         # Seed organizations
pnpm seed:clear        # Clear all data
```

## Common Tasks

### Add a new OAuth provider

1. Add provider config in `server/lib/auth.ts`
2. Add environment variables
3. Update `types/config.ts` if needed
4. Add button in `OAuthButtons.vue` component

### Customize auth pages

1. Pages are in `app/pages/auth/`
2. Override by creating same path in your app
3. Use components from `app/components/Auth/`

### Integrate with nuxt-crouton collections

Generated collections automatically import from `@crouton/auth/server`. Ensure:

1. `@crouton/auth` is installed as a dependency in your project
2. Export schema from main schema index:
   ```typescript
   // server/database/schema/index.ts
   export * from '@crouton/auth/server/database/schema/auth'
   ```

**Note**: The collection generator uses `@crouton/auth/server` directly (not the `#crouton/team-auth` alias).

## Rate Limiting (Recommended)

Authentication endpoints are prime targets for abuse. We recommend using `nuxthub-ratelimit` for rate limiting.

### Installation

```bash
pnpm add nuxthub-ratelimit
```

### Configuration

```typescript
// nuxt.config.ts
export default defineNuxtConfig({
  modules: ['@crouton/auth', 'nuxthub-ratelimit'],

  rateLimit: {
    routes: {
      // Strict limits for auth endpoints
      '/api/auth/*': {
        maxRequests: 15,
        intervalSeconds: 60
      },
      // More lenient for general API
      '/api/*': {
        maxRequests: 150,
        intervalSeconds: 60
      }
    }
  }
})
```

### Recommended Limits by Endpoint

| Endpoint Pattern | Max Requests | Interval | Reason |
|-----------------|--------------|----------|--------|
| `/api/auth/sign-in/*` | 10 | 60s | Prevent brute force |
| `/api/auth/sign-up/*` | 5 | 60s | Prevent account spam |
| `/api/auth/forgot-password` | 3 | 60s | Prevent email abuse |
| `/api/auth/verify-email` | 5 | 60s | Prevent verification spam |
| `/api/auth/scoped-access/*` | 10 | 60s | Public redeem endpoint — PIN brute force + pre-auth hook work (the before-redeem hook does a DB read per attempt) |
| `/api/auth/*` | 15 | 60s | General auth fallback |
| `/api/*` | 150 | 60s | General API |

### Requirements

- Requires NuxtHub with KV enabled
- Minimum TTL is 60 seconds (NuxtHub KV limitation)
- See [nuxthub-ratelimit docs](https://github.com/fayazara/nuxthub-ratelimit)

## Scoped Access Tokens & Grants

Provides lightweight, resource-scoped authentication for scenarios where full user accounts aren't needed:
- Event helpers (POS/sales)
- Guest access to bookings
- Temporary attendee access
- PIN-protected CMS pages

Two halves: **tokens** (the bearer credential a holder uses after login) and **grants** (the redeemable credential — e.g. a shared PIN — that mints tokens). Domains own the binding (which resource gets a grant, what role its tokens carry); auth owns verification, redemption limits, and brute-force lockout. Grants are deliberately **not accounts**: no email, no identity, no lifecycle beyond expiry.

### Transport Convention

The canonical header for scoped tokens is **`x-scoped-token`** (exported as `SCOPED_TOKEN_HEADER`); the canonical cookie is **`scoped-access-token`** (set by `useScopedAccess`, the redeem/mint endpoints, and read during SSR — e.g. by crouton-pages' scoped visibility). `validateScopedTokenFromEvent` checks, in order: `x-scoped-token` header → cookie → `Authorization: Bearer`. All consumers use these — there are no package-specific names.

### Grants (credential → token)

```typescript
import {
  upsertScopedGrant,          // create/update the grant for a resource
  verifyAndRedeemGrant,       // verify secret + lockout + maxUses, mint token
  revokeScopedGrantsForResource,
  listScopedGrantsForResource // never returns secrets
} from '@crouton/auth/server'

// Domain syncs its credential into a grant (e.g. on event save)
await upsertScopedGrant({
  organizationId: team.id,
  resourceType: 'event',
  resourceId: event.id,
  secret: event.pin,        // hashed before storage
  role: 'helper',           // stamped onto minted tokens
  // maxUses: 1,            // invite-code semantics; null = unlimited (shared PIN)
  // tokenTtl: 4 * 60 * 60 * 1000
})
```

Brute-force protection is per-grant: 5 consecutive failures lock redemption for an exponentially growing window (1 min → 1 hour cap). This — not the hash — is the security boundary for low-entropy PINs; never mint tokens for unverified input around it. `credentialType` is `'pin'` today; `'link'` (URL-embedded secret) is reserved.

`upsertScopedGrant` is safe to call on every login attempt (lazy sync — no backfill or save-hook is needed): counters and lockout are preserved when the secret is unchanged, and only a *changed* secret resets them. Pass `skipWhenLocked: true` for syncs driven by public login attempts — it skips the UPDATE while the grant is locked out, so an attacker can't drive a DB write per attempt. Note the upsert unconditionally overwrites `role`, `maxUses`, `expiresAt`, `tokenTtl`: a lazily-synced grant is fully owned by its sync and must never be hand-edited.

### Before-Redeem Hook (lazy credential sync)

The generic redeem endpoint fires `crouton:scoped-access:before-redeem` with `{ organizationId, resourceType, resourceId, credentialType }` **before** `verifyAndRedeemGrant`. Domain packages register a Nitro plugin handler that syncs their source credential into the grant (e.g. crouton-sales upserts `salesEvents.helperPin` into the `('event', eventId)` grant — trimmed, with `skipWhenLocked`). Auth stays domain-agnostic: it fires the hook without knowing what the resource is. Hook failures are logged and swallowed — the redeem then fails as a normal 401, indistinguishable from a wrong secret (no info leak on the public endpoint).

Grants can't FK into domain tables — call `revokeScopedGrantsForResource` when the resource is deleted.

### Token Server Utilities

```typescript
import {
  createScopedToken,
  validateScopedToken,
  validateScopedTokenFromEvent,
  requireScopedAccess,
  requireScopedAccessToResource,
  revokeScopedToken,
  revokeScopedTokensForResource,
  listScopedTokensForResource,
  SCOPED_TOKEN_HEADER
} from '@crouton/auth/server'

// Create a helper token
const { token, expiresAt } = await createScopedToken({
  organizationId: 'team-123',
  resourceType: 'event',
  resourceId: 'event-456',
  displayName: 'John Helper',
  role: 'helper',
  expiresIn: 8 * 60 * 60 * 1000 // 8 hours
})

// Validate in API handler
export default defineEventHandler(async (event) => {
  const access = await requireScopedAccess(event)
  // access.displayName, access.resourceId, etc.
})
```

### Client Composable

```typescript
// For POS helpers
const {
  isAuthenticated,
  displayName,
  resourceId,
  authHeaders,   // { 'x-scoped-token': token } — spread into $fetch headers
  redeem,        // redeem({ teamId, resourceId, secret, displayName }) via generic endpoint
  login,         // custom-endpoint variant (legacy/domain-specific logins)
  errorStatus,   // HTTP status of the last failed login/redeem (429 locked, 410 exhausted, …)
  logout
} = useEventAccess()

// Generic scoped access
const access = useScopedAccess('booking')
await access.redeem({ teamId, resourceId: bookingId, secret: pin, displayName: 'Guest' })
```

Sessions persist in a client-readable cookie keyed **per resource type** (`scoped-access-session-${resourceType}`), so every consumer of the same resource type lands on the same session (the pages gate and `useEventAccess` share `scoped-access-session-event`). The session cookie's `maxAge` follows the token's real `expiresAt` (not a fixed 8h), keeping the client session honest when a grant uses a custom `tokenTtl`. The httpOnly `scoped-access-token` cookie (server-set by redeem/mint) is for SSR validation only — client writes to it are silent no-ops and client code must never depend on reading it. Because JS can't clear an httpOnly cookie, **logout must go through the server**: `useScopedAccess().logout()` / `useEventAccess().logout()` **await** the `/api/auth/scoped-access/logout` POST (no longer fire-and-forget) so the clearing `Set-Cookie` lands before any reload — otherwise SSR keeps honoring a live cookie and a "logged-out" user still sees gated content.

### API Endpoints

| Endpoint | Method | Auth | Purpose |
|----------|--------|------|---------|
| `/api/auth/scoped-access/redeem` | POST | Public (the secret is the auth) | Present credential (PIN) → token; 429 + Retry-After when locked, 410 when exhausted, 401 otherwise (not_found and invalid_secret are indistinguishable) |
| `/api/auth/scoped-access/mint` | POST | Team member session | Delegation: mint a scoped token directly (no secret) |
| `/api/auth/scoped-access/validate` | POST | — | Validate a token |
| `/api/auth/scoped-access/logout` | POST | — | Revoke a token (read from the body **or** the `scoped-access-token` cookie) **and** clear that httpOnly cookie via `Set-Cookie`, so the next SSR request re-gates. No body required — the cookie alone is enough |
| `/api/auth/scoped-access/refresh` | POST | — | Extend token expiration |

Both redeem and mint also set the `scoped-access-token` cookie (httpOnly) so SSR can validate.

### Database Schema

The `scopedAccessToken` table stores:
- `token`: Unique authentication token
- `organizationId`: Team the token belongs to
- `resourceType`: Type of resource (e.g., 'event', 'booking')
- `resourceId`: ID of the specific resource
- `displayName`: Name of the token holder
- `role`: Authorization role (e.g., 'helper', 'guest')
- `expiresAt`: Token expiration timestamp

The `scopedAccessGrant` table stores the redeemable credential per resource:
- `credentialType`: `'pin'` (typed) — `'link'` reserved for URL-embedded secrets
- `secretHash`: Salted SHA-256 (`{salt}:{hash}`); plaintext never stored
- `maxUses` / `usedCount`: Redemption limits (null = unlimited shared PIN)
- `failedAttempts` / `lockedUntil`: Per-grant brute-force lockout state
- `tokenTtl`: Lifetime (ms) of tokens minted from this grant
- One grant per (organization, resourceType, resourceId, credentialType)

Consuming apps must regenerate migrations (`npx nuxt db generate`) after upgrading to pick up `scopedAccessGrant`.

## Demo Seeding (`@fyit/crouton-auth/seed`)

Ships a `SeedProvider` (id `auth`, no deps, runs first) for the composable
seeding system (epic #82, contract in `@fyit/crouton-core/shared/seed`). It
upserts the team `organization` (id `seed:org:<slug>`, slug e.g. `test1`) that
every domain provider hangs off. With `--with-staff` it also seeds a known staff
login — `user` + credential `account` (password hashed via `better-auth/crypto`'s
`hashPassword`, the scrypt envelope login verifies against) + owner `member`.
Idempotent (stable ids). Run via an app's `crouton-seed` / `db:seed:*` scripts.

## Dependencies

- **Extends**: None (standalone module/layer)
- **Used by**: `@fyit/crouton` and all crouton packages (canonical team auth)
- **Core deps**: better-auth, @better-auth/passkey
- **Recommended**: nuxthub-ratelimit (optional peer dependency for rate limiting)

## Testing

```bash
pnpm test              # Run all tests
pnpm test:unit         # Unit tests only
pnpm test:integration  # Integration tests only
```

## Naming Conventions

```
Component: AuthLoginForm, TeamSwitcher, AccountSettings
Composable: useAuth, useTeam, useSession
API: /api/auth/[...all] (Better Auth handles routing)
Middleware: auth, guest, team-context
```
