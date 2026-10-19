# @crouton/email

Email infrastructure layer for Nuxt applications: Vue single-file templates rendered server-side (no third-party email renderer) and [Resend](https://resend.com/) delivery.

## Features

- **Server-side email utilities** - Send emails via Resend with typed interfaces
- **Pre-built Vue Email templates** - Verification, magic link, password reset, team invite, welcome
- **Client-side flow components** - Ready-to-use verification and magic link UI flows
- **Brand customization** - Configure logo, colors, and app name for all templates
- **Standalone or integrated** - Works alone or enhances `@crouton/auth`

## Installation

```bash
pnpm add @crouton/email resend
```

## Quick Start

### 1. Add the layer to your Nuxt config

```typescript
// nuxt.config.ts
export default defineNuxtConfig({
  extends: ['@crouton/email'],

  runtimeConfig: {
    email: {
      resendApiKey: process.env.RESEND_API_KEY,
      from: 'noreply@example.com',
      fromName: 'My App',
    },
    public: {
      crouton: {
        email: {
          brand: {
            name: 'My App',
            primaryColor: '#0F766E',
            url: 'https://example.com',
          },
        },
      },
    },
  },
})
```

### 2. Set environment variables

```bash
RESEND_API_KEY=re_xxx
```

### 3. Send emails from server

```typescript
// server/api/auth/verify.post.ts
export default defineEventHandler(async (event) => {
  const { email, code } = await readBody(event)

  await sendVerificationEmail({
    to: email,
    code,
    name: 'John',
  })

  return { success: true }
})
```

### 4. Use client components

```vue
<template>
  <EmailVerificationFlow
    :email="userEmail"
    @verified="handleVerified"
    @resend="handleResend"
  />
</template>
```

## Server Utilities

### Email Service

Low-level email sending with full control:

```typescript
const emailService = useEmailService()

const result = await emailService.send({
  to: 'user@example.com',
  subject: 'Hello',
  html: '<p>Hello World</p>',
})
```

### Convenience Senders

Pre-built functions for common email types:

```typescript
// Verification code email
await sendVerificationEmail({
  to: 'user@example.com',
  code: '123456',
  name: 'John',
  expiryMinutes: 10,
})

// Magic link login
await sendMagicLink({
  to: 'user@example.com',
  link: 'https://app.com/auth/magic?token=xxx',
  name: 'John',
})

// Password reset
await sendPasswordReset({
  to: 'user@example.com',
  link: 'https://app.com/auth/reset?token=xxx',
  name: 'John',
})

// Team invitation
await sendTeamInvite({
  to: 'user@example.com',
  link: 'https://app.com/invite/accept?token=xxx',
  inviterName: 'Jane',
  teamName: 'Acme Inc',
  role: 'member',
})

// Welcome email
await sendWelcome({
  to: 'user@example.com',
  name: 'John',
  getStartedLink: 'https://app.com/getting-started',
})
```

## Client Components

### EmailVerificationFlow

Complete verification code input with resend functionality.

```vue
<template>
  <EmailVerificationFlow
    :email="userEmail"
    :code-length="6"
    :resend-cooldown="60"
    :loading="isVerifying"
    :error="verificationError"
    @verified="handleVerified"
    @resend="handleResend"
  />
</template>

<script setup>
const handleVerified = (code) => {
  // Submit code to your API
}

const handleResend = () => {
  // Request new verification code
}
</script>
```

**Props:**

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `email` | `string` | required | Email being verified |
| `codeLength` | `number` | `6` | Expected code length |
| `resendCooldown` | `number` | `60` | Cooldown in seconds |
| `loading` | `boolean` | `false` | Loading state |
| `error` | `string` | `''` | Error message |

**Events:**

| Event | Payload | Description |
|-------|---------|-------------|
| `verified` | `code: string` | Code submitted |
| `resend` | - | Resend requested |
| `error` | `error: string` | Error occurred |

### EmailMagicLinkSent

"Check your email" message for magic link flows.

```vue
<template>
  <EmailMagicLinkSent
    :email="userEmail"
    :resend-cooldown="60"
    @resend="handleResend"
    @change-email="handleChangeEmail"
  />
</template>
```

**Props:**

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `email` | `string` | required | Email where link was sent |
| `resendCooldown` | `number` | `60` | Cooldown in seconds |
| `loading` | `boolean` | `false` | Loading state |
| `error` | `string` | `''` | Error message |

**Events:**

| Event | Payload | Description |
|-------|---------|-------------|
| `resend` | - | Resend requested |
| `change-email` | - | Change email requested |

### EmailResendButton

Standalone resend button with countdown timer.

```vue
<template>
  <EmailResendButton
    :cooldown="60"
    :loading="isResending"
    :disabled="false"
    @resend="handleResend"
  />
</template>
```

**Props:**

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `cooldown` | `number` | `60` | Cooldown in seconds |
| `loading` | `boolean` | `false` | Loading state |
| `disabled` | `boolean` | `false` | Disabled state |

**Events:**

| Event | Payload | Description |
|-------|---------|-------------|
| `resend` | - | Button clicked (after cooldown) |

### EmailInput

Email input with real-time validation.

```vue
<template>
  <EmailInput
    v-model="email"
    :error="emailError"
    placeholder="Enter your email"
    @valid="handleValidation"
  />
</template>
```

**Props:**

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `modelValue` | `string` | `''` | Email value (v-model) |
| `error` | `string` | `''` | External error message |
| `placeholder` | `string` | `'you@example.com'` | Input placeholder |
| `disabled` | `boolean` | `false` | Disabled state |
| `autofocus` | `boolean` | `false` | Autofocus on mount |

**Events:**

| Event | Payload | Description |
|-------|---------|-------------|
| `update:modelValue` | `email: string` | Email changed |
| `valid` | `isValid: boolean` | Validation state |

## Email Templates

Pre-built Vue Email templates in `server/emails/`:

| Template | Purpose | Key Props |
|----------|---------|-----------|
| `BaseLayout.vue` | Shared layout | `brandName`, `logoUrl`, `primaryColor` |
| `Verification.vue` | Verification code | `code`, `name`, `expiryMinutes` |
| `MagicLink.vue` | Magic link login | `link`, `name`, `expiryMinutes` |
| `PasswordReset.vue` | Password reset | `link`, `name`, `expiryMinutes` |
| `TeamInvite.vue` | Team invitation | `link`, `inviterName`, `teamName`, `role` |
| `Welcome.vue` | Welcome email | `name`, `getStartedLink` |

## Configuration

### Full Configuration

```typescript
// nuxt.config.ts
export default defineNuxtConfig({
  extends: ['@crouton/email'],

  runtimeConfig: {
    // Server-only (private)
    email: {
      resendApiKey: process.env.RESEND_API_KEY,
      from: 'noreply@example.com',
      fromName: 'My App',
      replyTo: 'support@example.com', // optional
    },

    // Public (available on client)
    public: {
      crouton: {
        email: {
          brand: {
            name: 'My App',
            logoUrl: 'https://example.com/logo.png', // optional
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

### Environment Variables

```bash
# Required
RESEND_API_KEY=re_xxx

# Optional (can be set in nuxt.config.ts instead)
EMAIL_FROM=noreply@example.com
EMAIL_FROM_NAME=My App
EMAIL_REPLY_TO=support@example.com
```

## Integration with @crouton/auth

When used with `@crouton/auth`, email utilities are automatically available for:

- Email verification on signup
- Magic link authentication
- Password reset emails
- Team invitation emails

```typescript
// nuxt.config.ts
export default defineNuxtConfig({
  extends: ['@crouton/auth', '@crouton/email'],

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
// server/api/auth/send-code.post.ts
export default defineEventHandler(async (event) => {
  const { email } = await readBody(event)

  // Generate your verification code
  const code = Math.random().toString().slice(2, 8)

  // Save code to your database
  await saveVerificationCode(email, code)

  // Send email
  await sendVerificationEmail({ to: email, code })

  return { success: true }
})
```

```typescript
// server/api/auth/verify-code.post.ts
export default defineEventHandler(async (event) => {
  const { email, code } = await readBody(event)

  // Verify code from your database
  const isValid = await verifyCode(email, code)

  if (!isValid) {
    throw createError({ statusCode: 400, message: 'Invalid code' })
  }

  return { success: true }
})
```

## Custom Templates

Create your own templates using the base layout:

```vue
<!-- server/emails/CustomEmail.vue -->
<script setup lang="ts">
import { EText, EButton, ESection } from '#crouton-email/server/emails/primitives'
import BaseLayout from '#crouton-email/server/emails/BaseLayout.vue'

interface Props {
  customProp: string
  brandName?: string
  primaryColor?: string
}

defineProps<Props>()
</script>

<template>
  <BaseLayout :brand-name="brandName" :primary-color="primaryColor">
    <ESection>
      <EText>Your custom content: {{ customProp }}</EText>
    </ESection>
  </BaseLayout>
</template>
```

Then create a sender function:

```typescript
// server/utils/custom-senders.ts
import CustomEmail from '../emails/CustomEmail.vue'
import { renderEmailTemplate, getEmailBrandConfig } from './template-renderer'
import { useEmailService } from './email'

export async function sendCustomEmail(options: {
  to: string
  customProp: string
}) {
  const brandConfig = getEmailBrandConfig()

  const { html, text } = await renderEmailTemplate(CustomEmail, {
    customProp: options.customProp,
    ...brandConfig,
  })

  return useEmailService().send({
    to: options.to,
    subject: 'Custom Email',
    html,
    text,
  })
}
```

## TypeScript

All interfaces are exported from `types/index.ts`:

```typescript
import type {
  SendEmailOptions,
  SendEmailResult,
  VerificationEmailOptions,
  MagicLinkEmailOptions,
  PasswordResetEmailOptions,
  TeamInviteEmailOptions,
  WelcomeEmailOptions,
  EmailConfig,
  EmailPublicConfig,
} from '@crouton/email/types'
```

## Testing

Use Resend's test mode for development:

```bash
# Use Resend's test API key (emails won't be delivered)
RESEND_API_KEY=re_test_xxx
```

## License

MIT
