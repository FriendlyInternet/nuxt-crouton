# Changelog

All notable changes to `@fyit/crouton-auth` will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- `signup: 'open' | 'invite'` option (default `'open'`). `'invite'` refuses account creation (password, magic link, OAuth) unless the email has a pending invitation; super admins are exempt; register links are hidden. Note: a pending invitation does not prove mailbox ownership until verify-on-signup lands (#3138).

## [0.1.0] - 2024-12-17

### Added

#### Authentication
- Email/password authentication with configurable password requirements
- OAuth providers support: GitHub, Google, Discord
- Passkey (WebAuthn) authentication with conditional UI (autofill) support
- Two-factor authentication (2FA) with TOTP and backup codes
- Magic link authentication
- Session management with configurable expiry and cookie settings
- Password reset flow with email verification

#### Three Operational Modes
- **Multi-tenant mode**: Users can create and join multiple organizations
- **Single-tenant mode**: One organization with multiple users, auto-created on first boot
- **Personal mode**: One organization per user, auto-created on signup

#### Teams/Organizations
- Full team management via Better Auth's Organization plugin
- Team creation, updates, and deletion
- Member invitation system with configurable expiry
- Role-based access control: owner, admin, member
- Team switching for multi-tenant mode
- Organization limits per user (configurable)

#### Billing (Stripe)
- Subscription management via Better Auth's Stripe plugin
- Checkout flow integration
- Customer portal access
- Plan upgrades and downgrades
- Subscription cancellation and restoration
- Trial period support
- Both user-based and organization-based billing modes

#### Composables
- `useAuth()` - Authentication methods and state
- `useSession()` - Session management and reactive state
- `useTeam()` - Team management with mode-aware behavior
- `useTeamContext()` - Mode-aware team context resolution
- `useTeamState()` - Team state management (SSR-safe)
- `useBilling()` - Subscription and billing management

#### Server Utilities
- `resolveTeamAndCheckMembership()` - Mode-aware team resolution with membership validation
- `requireTeamMember()` / `requireTeamAdmin()` / `requireTeamOwner()` - Role-based authorization
- `getTeamById()` / `getTeamBySlug()` - Team lookup utilities
- `getUserTeams()` / `getMembership()` - Membership queries
- `canUserCreateTeam()` - Team creation limit checks

#### UI Components

**Auth Components**
- `AuthLoginForm` - Complete login form with email/password
- `AuthRegisterForm` - Registration form with validation
- `AuthForgotPasswordForm` - Password reset request
- `AuthOAuthButtons` - OAuth provider buttons
- `AuthPasskeyButton` - Passkey login button
- `AuthMagicLinkForm` - Magic link form
- `AuthTwoFactorForm` - 2FA verification form

**Account Components**
- `AccountSettings` - Combined account settings
- `AccountProfileForm` - Edit name and avatar
- `AccountPasswordForm` - Change password
- `AccountPasskeyManager` - Manage registered passkeys
- `AccountTwoFactorSetup` - 2FA setup wizard
- `AccountLinkedAccounts` - OAuth connections management
- `AccountDeleteAccount` - Account deletion with confirmation

**Team Components**
- `TeamSwitcher` - Team selection dropdown
- `TeamCreateForm` - Create new team
- `TeamSettings` - Team settings form
- `TeamMembers` - Members list with management
- `TeamMemberRow` - Individual member display
- `TeamMemberInviteForm` - Member invitation form
- `TeamInvitations` - Pending invitations list
- `TeamDeleteConfirm` - Delete confirmation modal

**Billing Components**
- `BillingCurrentPlan` - Current subscription display
- `BillingPlanCard` - Individual plan card
- `BillingPricingTable` - Pricing comparison table
- `BillingUpgradeButton` - Upgrade CTA
- `BillingPortalButton` - Stripe portal access
- `BillingUsageDisplay` - Usage metrics

**Sidebar Components**
- `SidebarAuthSidebar` - Main dashboard sidebar
- `SidebarTeamSection` - Team switcher section
- `SidebarUserMenu` - User dropdown menu

#### Middleware
- `auth` - Requires authentication
- `guest` - Requires NO authentication
- `team-context.global` - Resolves team context from URL

#### Pages
- `/auth/login` - Login page
- `/auth/register` - Registration page
- `/auth/forgot-password` - Password reset request
- `/auth/reset-password` - Password reset with token
- `/auth/verify-email` - Email verification
- `/auth/magic-link` - Magic link verification
- `/dashboard/` - Dashboard landing (mode-aware routes)
- `/dashboard/settings/` - Account settings
- `/dashboard/settings/security` - Security settings (2FA, passkeys)
- `/dashboard/settings/team` - Team settings (multi-tenant)
- `/dashboard/settings/members` - Team members (multi-tenant)
- `/dashboard/settings/billing` - Billing management

#### Database Schema
- Full Drizzle schema for Better Auth tables
- Extended organization table with `personal`, `isDefault`, and `ownerId` columns
- Proper indexes for efficient queries
- SQLite/D1 compatibility for NuxtHub

#### Developer Experience
- Full TypeScript support with exported types
- Comprehensive documentation
- Migration scripts (`migrate:status`, `migrate:generate`, `migrate:push`)
- Development seed script with test users, orgs, and subscriptions
- 287 tests passing (unit + integration)
- Performance documentation
- Security review checklist

#### Error Handling & UX
- Standardized error messages with i18n support
- Loading states and skeletons
- FOUC prevention with AuthGuard component
- CSS transitions and animations
- Dark mode support
- Responsive design utilities

### Dependencies
- `better-auth` ^1.2.0
- `@better-auth/passkey` ^1.2.0
- `@better-auth/stripe` ^1.2.0
- `stripe` ^17.0.0
- `defu` ^6.1.4

### Peer Dependencies
- `nuxt` ^3.14.0 || ^4.0.0
- `@nuxt/ui` ^3.0.0-alpha.0 (optional)

---

<!-- Links will be added when package is published to npm -->
