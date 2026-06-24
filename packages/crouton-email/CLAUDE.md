# CLAUDE.md - @crouton/email

## Package Purpose

Email infrastructure layer for Nuxt applications using Vue Email templates and Resend delivery. Provides server-side email utilities and client-side flow components for verification, magic links, password resets, and team invitations. Works standalone or integrates with `@crouton/auth`.

## Key Files

| File | Purpose |
|------|---------|
| `nuxt.config.ts` | Layer configuration with runtime config |
| `brand/email-brand.mjs` | **Brand identity SSOT** (name, primary accent, URL, logo, sans stack) — plain ESM so the dependency-free digest `render.mjs` scripts can import it too. `.d.mts` sibling for types |
| `server/utils/email.ts` | Resend service wrapper (`useEmailService()`) |
| `server/utils/senders.ts` | Convenience send functions |
| `server/utils/template-renderer.ts` | Vue Email template rendering |
| `server/emails/*.vue` | Vue Email templates |
| `app/components/Email/*.vue` | Client flow components |
| `types/index.ts` | TypeScript type definitions |

## Server Utilities

### Email Service (`useEmailService()`)

```typescript
import { useEmailService } from '#crouton-email/server/utils/email'

const emailService = useEmailService()

// Send raw email
const result = await emailService.send({
  to: 'user@example.com',
  subject: 'Hello',
  html: '<p>Hello World</p>'
})
```

### Convenience Senders

```typescript
import {
  sendVerificationEmail,
  sendMagicLink,
  sendPasswordReset,
  sendTeamInvite,
  sendWelcome
} from '#crouton-email/server/utils/senders'

// Send verification code email
await sendVerificationEmail({
  to: 'user@example.com',
  code: '123456',
  name: 'John'
})

// Send magic link
await sendMagicLink({
  to: 'user@example.com',
  link: 'https://app.com/auth/magic?token=xxx',
  name: 'John'
})

// Send password reset
await sendPasswordReset({
  to: 'user@example.com',
  link: 'https://app.com/auth/reset?token=xxx',
  name: 'John'
})

// Send team invitation
await sendTeamInvite({
  to: 'user@example.com',
  link: 'https://app.com/invite/accept?token=xxx',
  inviterName: 'Jane',
  teamName: 'Acme Inc',
  role: 'member'
})

// Send welcome email
await sendWelcome({
  to: 'user@example.com',
  name: 'John',
  getStartedLink: 'https://app.com/getting-started'
})
```

## Client Components

### EmailVerificationFlow

Complete verification code input flow with resend functionality.

```vue
<template>
  <EmailVerificationFlow
    :email="userEmail"
    @verified="handleVerified"
    @resend="handleResend"
    @error="handleError"
  />
</template>
```

**Props:**
- `email: string` - Email being verified
- `codeLength?: number` - Code length (default: 6)
- `resendCooldown?: number` - Cooldown in seconds (default: 60)

**Events:**
- `verified(code: string)` - Code entered
- `resend()` - Resend requested
- `error(error: Error)` - Error occurred

### MagicLinkSent

"Check your email" message with resend option.

```vue
<template>
  <MagicLinkSent
    :email="userEmail"
    @resend="handleResend"
    @change-email="handleChangeEmail"
  />
</template>
```

**Props:**
- `email: string` - Email where link was sent
- `resendCooldown?: number` - Cooldown in seconds (default: 60)

**Events:**
- `resend()` - Resend requested
- `change-email()` - Change email requested

### ResendButton

Timer-based resend button with cooldown.

```vue
<template>
  <ResendButton
    :cooldown="60"
    :loading="isResending"
    @resend="handleResend"
  />
</template>
```

**Props:**
- `cooldown?: number` - Cooldown in seconds (default: 60)
- `loading?: boolean` - Loading state
- `disabled?: boolean` - Disabled state

**Events:**
- `resend()` - Button clicked (only when cooldown complete)

### EmailInput

Email input with validation.

```vue
<template>
  <EmailInput
    v-model="email"
    :error="emailError"
    placeholder="Enter your email"
  />
</template>
```

**Props:**
- `modelValue: string` - Email value (v-model)
- `error?: string` - Error message
- `placeholder?: string` - Input placeholder
- `disabled?: boolean` - Disabled state

**Events:**
- `update:modelValue(email: string)` - Email changed
- `valid(isValid: boolean)` - Validation state changed

## Email Templates

Located in `server/emails/`:

| Template | Purpose | Props |
|----------|---------|-------|
| `BaseLayout.vue` | Shared layout with header/footer | `brandName`, `logoUrl`, `primaryColor` |
| `Verification.vue` | Verification code email | `code`, `name`, `expiryMinutes` |
| `MagicLink.vue` | Magic link login email | `link`, `name`, `expiryMinutes` |
| `PasswordReset.vue` | Password reset email | `link`, `name`, `expiryMinutes` |
| `TeamInvite.vue` | Team invitation email | `link`, `inviterName`, `teamName`, `role` |
| `Welcome.vue` | Welcome email | `name`, `getStartedLink` |

## Brand Identity SSOT (`brand/email-brand.mjs`)

One dependency-free module is the single source of truth for the email *identity*
(brand name, primary accent `#0F766E`, canonical URL, logo, sans font stack). It's
authored as plain `.mjs` (with a hand-written `.d.mts` for types) so it can be
imported from **two very different worlds**:

- `server/emails/BaseLayout.vue` uses it for its prop defaults (`brandName`,
  `primaryColor`, font stack).
- The standalone digest renderers (`.claude/skills/epic-digest/render.mjs`,
  `.claude/skills/housekeeping/render.mjs`) import it via a relative path. These run
  in a GitHub Action with **no transpile and no npm install**, so the module must
  stay pure ESM — never convert it to `.ts`.

Scope is **identity only**, not a shared visual system: the transactional templates
stay minimal/sans; epic-digest keeps its editorial serif + fluorescent palette + dark
mode and only borrows the brand name/URL (footer) and accent colour (masthead). Change
the identity here once and every surface follows. Exported from the package as
`@fyit/crouton-email/brand`. (See issue #744.)

## Configuration

```typescript
// nuxt.config.ts
export default defineNuxtConfig({
  extends: ['@crouton/email'],

  runtimeConfig: {
    email: {
      resendApiKey: process.env.RESEND_API_KEY,
      from: 'noreply@example.com',
      fromName: 'My App',
      replyTo: 'support@example.com', // optional
    },
    public: {
      crouton: {
        email: {
          brand: {
            name: 'My App',
            logoUrl: 'https://example.com/logo.png',
            primaryColor: '#0F766E',
            url: 'https://example.com',
          },
          verification: {
            codeLength: 6,
            codeExpiry: 10, // minutes
            resendCooldown: 60, // seconds
          },
          magicLink: {
            expiry: 10, // minutes
            resendCooldown: 60, // seconds
          },
        },
      },
    },
  },
})
```

## Environment Variables

```bash
# Required
RESEND_API_KEY=re_xxx

# Optional (can be set in nuxt.config.ts)
EMAIL_FROM=noreply@example.com
EMAIL_FROM_NAME=My App
EMAIL_REPLY_TO=support@example.com
```

## Integration with @crouton/auth

When using with `@crouton/auth`, the auth package will automatically use email utilities for:
- Email verification on signup
- Magic link authentication
- Password reset emails
- Team invitation emails

```typescript
// In your auth configuration
export default defineNuxtConfig({
  extends: ['@crouton/auth', '@crouton/email'],

  // Email config will be used automatically by auth
  runtimeConfig: {
    email: {
      resendApiKey: process.env.RESEND_API_KEY,
      from: 'noreply@example.com',
      fromName: 'My App',
    },
  },
})
```

## Standalone Usage

Works without `@crouton/auth`. Implement your own endpoints:

```typescript
// server/api/auth/verify.post.ts
export default defineEventHandler(async (event) => {
  const { email } = await readBody(event)

  // Generate your verification code
  const code = generateCode()

  // Save code to your database
  await saveVerificationCode(email, code)

  // Send email using crouton-email
  const { sendVerificationEmail } = await import('#crouton-email/server/utils/senders')
  await sendVerificationEmail({ to: email, code })

  return { success: true }
})
```

## Common Tasks

### Customize email templates

1. Create your own template in `server/emails/`
2. Use the `BaseLayout` component for consistent styling
3. Import and use your template in sender functions

### Add a new email type

1. Create template in `server/emails/NewEmail.vue`
2. Add types in `types/index.ts`
3. Add sender function in `server/utils/senders.ts`

### Test emails locally

Use Resend's test mode or configure a test API key:

```bash
# Use Resend's test API key
RESEND_API_KEY=re_test_xxx
```

## Dependencies

- **Core deps**: vue-email, resend
- **Works with**: `@crouton/auth` (optional, enhances auth emails)
- **Peer deps**: nuxt, @nuxt/ui (optional)

## Naming Conventions

```
Component: EmailVerificationFlow, EmailInput, ResendButton
Server util: useEmailService, sendVerificationEmail, sendMagicLink
Template: Verification.vue, MagicLink.vue, TeamInvite.vue
Type: SendEmailOptions, VerificationEmailOptions
```
