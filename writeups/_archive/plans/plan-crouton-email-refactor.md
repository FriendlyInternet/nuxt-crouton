> 🗄️ **Archived 2026-11-04 (#3352) — dropped:** Resend is still the only transport; the portability initiative it served (https://github.com/FriendlyInternet/nuxt-crouton/issues/1636) was closed not planned. Historical record, not current guidance.

# Crouton Email — Multi-Driver Refactor Plan

## Summary

Refactor `packages/crouton-email` to replace the Resend SDK with a multi-driver system using HTTP REST APIs. Everything above the transport layer stays the same — templates, components, senders, auth integration. Users pick their email provider via config. Resend stays as the default driver for backwards compatibility.

**Motivation**: The [EU hosting plan](./plan-crouton-eu-hosting.md) adds VPS self-hosting on Hetzner. EU users need EU email providers (Mailgun EU, Brevo, Scaleway) instead of Resend (US). The multi-driver approach makes this a config change, not a code change.

---

## What Stays

| Layer | Status |
|---|---|
| Vue Email templates (`server/emails/*.vue`) — 6 templates: Verification, VerificationLink, MagicLink, PasswordReset, TeamInvite, Welcome | ✅ No change |
| Client components (`EmailVerificationFlow`, `MagicLinkSent`, `ResendButton`, `EmailInput`) | ✅ No change |
| Convenience senders in `server/utils/senders.ts` (`sendVerificationEmail`, `sendVerificationLink`, `sendMagicLink`, `sendPasswordReset`, `sendTeamInvite`, `sendWelcome`) | ✅ No change |
| Template renderer (`server/utils/template-renderer.ts`) — `renderEmailTemplate()`, `getEmailBrandConfig()` | ✅ No change |
| `@crouton/auth` integration — emits `crouton:auth:email` Nitro hooks, listened by `server/plugins/auth-email-listener.ts` | ✅ No change |
| `crouton-bookings` integration — wraps `useEmailService()` via `getBookingEmailService()` + `CustomEmailProvider` | ✅ No change (auto-benefits) |
| `SendEmailResult` return type (`{ success, id?, error? }`) | ✅ Preserved exactly |

## What Changes

| File | Change |
|---|---|
| `server/utils/email.ts` | Replace Resend SDK with driver resolution via HTTP APIs |
| `server/utils/drivers/` | **New directory** — one file per driver |
| `nuxt.config.ts` | Add `driver` field, keep `resendApiKey` as fallback |
| `package.json` | Remove `resend`, add `nodemailer` as optional |
| `types/index.ts` | Add `EmailDriver` type, extend `EmailConfig` |

---

## Codebase Findings (Resolved)

All investigated — no remaining open questions.

### Current `server/utils/email.ts`

- Imports `Resend` SDK directly, creates singleton client
- `useEmailService()` returns `{ send, sendBatch }` — both must be preserved
- `send()` returns `SendEmailResult`: `{ success: boolean, id?: string, error?: string }`
- Emits `crouton:operation` hooks with timing, recipient, subject, status metadata
- Supports `headers` and `tags` in `SendEmailOptions` (Resend-specific, see note below)
- Exports a convenience singleton `emailService` at module level

### Sender Integration

All 5 convenience senders in `senders.ts` call `useEmailService().send()`. No sender touches the Resend SDK directly. This means the refactor is a clean single-file change — `email.ts` is the only touch point.

### Auth Integration

`@crouton/auth` imports from `#crouton-email/server/utils/senders` via the layer alias defined in `nuxt.config.ts`. This boundary is stable and won't break.

### Bookings Integration

`crouton-bookings` has its own `CustomEmailProvider` abstraction layer (`server/utils/email-service.ts`). It resolves `useEmailService()` dynamically via `getBookingEmailService()`. The refactor is transparent to bookings — it calls `send()` and gets back `{ success, id?, error? }`.

### Triage (Not Affected)

`crouton-triage` uses the Resend REST API for **inbound** email fetching (`/emails/receiving/{id}`) via raw `fetch()` in `server/utils/resendEmail.ts`. This is a receive-side concern, not send-side. Completely unaffected by this refactor. The `resend` npm package is NOT used by triage.

### Current Config Shape

```ts
// nuxt.config.ts (current)
runtimeConfig: {
  email: {
    resendApiKey: '',  // RESEND_API_KEY
    from: '',          // EMAIL_FROM
    fromName: '',      // EMAIL_FROM_NAME
    replyTo: ''        // EMAIL_REPLY_TO
  }
}
```

Only `resendApiKey` is provider-specific. No other Resend-specific settings.

### Package Dependencies

```json
{
  "dependencies": {
    "@vitejs/plugin-vue": "^5.0.0",
    "resend": "^4.0.0",
    "vue-email": "^0.8.0"
  }
}
```

No other Resend-related deps. No peer deps on Resend.

### Tests

No tests exist for crouton-email. Tests are net-new work.

---

## Runtime Compatibility Constraint

Crouton apps deploy to both **Cloudflare Workers** (existing) and **Node.js VPS** (EU hosting plan). The driver system must work on both:

| Runtime | SMTP (nodemailer) | HTTP APIs (fetch) |
|---|---|---|
| Cloudflare Workers | **Broken** — requires `net`, `tls` | Works |
| Node.js (VPS/Docker) | Works | Works |

**Decision**: HTTP REST API drivers are the primary approach (works everywhere). The `smtp` driver uses nodemailer as an **optional** dependency, dynamically imported, Node.js-only.

---

## Driver System

### Architecture

Each driver is a factory that returns a `send()` function using the provider's HTTP REST API. No SMTP, no nodemailer (except the escape-hatch `smtp` driver).

### `server/utils/drivers/index.ts`

```ts
import type { SendEmailPayload, SendEmailDriverResult } from '../../../types'

export interface EmailDriver {
  send(payload: SendEmailPayload): Promise<SendEmailDriverResult>
}

export type DriverFactory = (config: Record<string, any>) => EmailDriver
```

### `server/utils/drivers/resend.ts`

```ts
import type { DriverFactory } from '.'

export const resend: DriverFactory = (config) => ({
  async send(payload) {
    const res = await $fetch<{ id: string }>('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${config.apiKey}` },
      body: {
        from: payload.from,
        to: payload.to,
        subject: payload.subject,
        html: payload.html,
        text: payload.text,
        reply_to: payload.replyTo,
        cc: payload.cc,
        bcc: payload.bcc,
        headers: payload.headers,
        tags: payload.tags,
      },
    })
    return { id: res.id }
  },
})
```

### `server/utils/drivers/mailgun.ts`

```ts
import type { DriverFactory } from '.'

export const mailgun: DriverFactory = (config) => ({
  async send(payload) {
    const form = new FormData()
    form.append('from', payload.from)
    payload.to.forEach(addr => form.append('to', addr))
    form.append('subject', payload.subject)
    if (payload.html) form.append('html', payload.html)
    if (payload.text) form.append('text', payload.text)
    if (payload.replyTo) form.append('h:Reply-To', payload.replyTo)
    payload.cc?.forEach(addr => form.append('cc', addr))
    payload.bcc?.forEach(addr => form.append('bcc', addr))

    // Use EU endpoint by default — Mailgun EU is the reason to use this driver
    const region = config.region === 'us' ? 'api.mailgun.net' : 'api.eu.mailgun.net'
    const res = await $fetch<{ id: string }>(`https://${region}/v3/${config.domain}/messages`, {
      method: 'POST',
      headers: { Authorization: `Basic ${btoa(`api:${config.apiKey}`)}` },
      body: form,
    })
    return { id: res.id }
  },
})
```

### `server/utils/drivers/postmark.ts`

```ts
import type { DriverFactory } from '.'

export const postmark: DriverFactory = (config) => ({
  async send(payload) {
    const res = await $fetch<{ MessageID: string }>('https://api.postmarkapp.com/email', {
      method: 'POST',
      headers: {
        'X-Postmark-Server-Token': config.apiKey,
        'Content-Type': 'application/json',
      },
      body: {
        From: payload.from,
        To: payload.to.join(', '),
        Subject: payload.subject,
        HtmlBody: payload.html,
        TextBody: payload.text,
        ReplyTo: payload.replyTo,
        Cc: payload.cc?.join(', '),
        Bcc: payload.bcc?.join(', '),
      },
    })
    return { id: res.MessageID }
  },
})
```

### `server/utils/drivers/brevo.ts`

```ts
import type { DriverFactory } from '.'

// Parse "Name <email>" format into { name, email }
function parseAddress(addr: string): { email: string; name?: string } {
  const match = addr.match(/^(.+)\s<(.+)>$/)
  return match ? { name: match[1], email: match[2] } : { email: addr }
}

export const brevo: DriverFactory = (config) => ({
  async send(payload) {
    const res = await $fetch<{ messageId: string }>('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: {
        'api-key': config.apiKey,
        'Content-Type': 'application/json',
      },
      body: {
        sender: parseAddress(payload.from),
        to: payload.to.map(email => ({ email })),
        subject: payload.subject,
        htmlContent: payload.html,
        textContent: payload.text,
        replyTo: payload.replyTo ? parseAddress(payload.replyTo) : undefined,
        cc: payload.cc?.map(email => ({ email })),
        bcc: payload.bcc?.map(email => ({ email })),
      },
    })
    return { id: res.messageId }
  },
})
```

### `server/utils/drivers/scaleway.ts`

```ts
import type { DriverFactory } from '.'

export const scaleway: DriverFactory = (config) => ({
  async send(payload) {
    const res = await $fetch<{ emails: Array<{ message_id: string }> }>(
      'https://api.scaleway.com/transactional-email/v1alpha1/regions/fr-par/emails',
      {
        method: 'POST',
        headers: {
          'X-Auth-Token': config.secretKey,
          'Content-Type': 'application/json',
        },
        body: {
          from: { email: payload.from },
          to: payload.to.map(email => ({ email })),
          subject: payload.subject,
          html: payload.html,
          text: payload.text,
          project_id: config.projectId,
        },
      },
    )
    return { id: res.emails?.[0]?.message_id || 'unknown' }
  },
})
```

### `server/utils/drivers/smtp.ts` (Node.js only)

```ts
import type { DriverFactory } from '.'

export const smtp: DriverFactory = (config) => {
  let _transport: any = null

  return {
    async send(payload) {
      if (!_transport) {
        // Dynamic import — nodemailer is optional, only loaded for smtp driver
        const { createTransport } = await import('nodemailer')
        _transport = createTransport({
          host: config.host,
          port: config.port || 587,
          secure: config.secure ?? false,
          auth: config.auth,
        })
      }

      const result = await _transport.sendMail({
        from: payload.from,
        to: payload.to,
        subject: payload.subject,
        html: payload.html,
        text: payload.text,
        replyTo: payload.replyTo,
        cc: payload.cc,
        bcc: payload.bcc,
      })
      return { id: result.messageId }
    },
  }
}
```

### Provider Comparison

| Driver | API Type | EU Data | Deliverability | Notes |
|---|---|---|---|---|
| `resend` | HTTP REST | ❌ US | Very good | Current default. Keep for backwards compat |
| `mailgun` | HTTP REST | ✅ EU region | ~97% | Swedish-owned (Sinch). Best EU option |
| `postmark` | HTTP REST | ❌ US | ~99% | Best deliverability overall |
| `brevo` | HTTP REST | ✅ France | ~79% | Free tier (300/day). Fine for staging |
| `scaleway` | HTTP REST | ✅ France | Unproven | Cheapest EU option (€0.25/1000) |
| `smtp` | SMTP | Varies | Varies | Node.js only. Escape hatch for any provider |

---

## Refactored `server/utils/email.ts`

Preserves the exact existing API surface: `send()`, `sendBatch()`, `crouton:operation` hooks, `SendEmailResult` return type, singleton export.

```ts
/// <reference path="../crouton-hooks.d.ts" />
import { useNitroApp } from 'nitropack/runtime'
import type { SendEmailOptions, SendEmailResult, SendEmailPayload } from '../../types'
import type { EmailDriver } from './drivers'

// Driver registry — lazy-loaded
const driverImports: Record<string, () => Promise<{ default: any } | any>> = {
  resend: () => import('./drivers/resend').then(m => m.resend),
  mailgun: () => import('./drivers/mailgun').then(m => m.mailgun),
  postmark: () => import('./drivers/postmark').then(m => m.postmark),
  brevo: () => import('./drivers/brevo').then(m => m.brevo),
  scaleway: () => import('./drivers/scaleway').then(m => m.scaleway),
  smtp: () => import('./drivers/smtp').then(m => m.smtp),
}

let _driver: EmailDriver | null = null

async function getDriver(): Promise<EmailDriver> {
  if (_driver) return _driver

  const config = useRuntimeConfig()
  const emailConfig = (config as any).email

  // Resolve driver name (default to resend)
  const driverName = emailConfig?.driver || 'resend'

  // Resolve API key — support both new `apiKey` and legacy `resendApiKey`
  if (driverName === 'resend' && !emailConfig?.apiKey && emailConfig?.resendApiKey) {
    emailConfig.apiKey = emailConfig.resendApiKey
  }

  const driverLoader = driverImports[driverName]
  if (!driverLoader) {
    throw new Error(
      `Unknown email driver: "${driverName}". Available: ${Object.keys(driverImports).join(', ')}`
    )
  }

  const factory = await driverLoader()
  _driver = factory(emailConfig)
  return _driver
}

/**
 * Email service — drop-in replacement preserving the existing API
 */
export function useEmailService() {
  const config = useRuntimeConfig()
  const emailConfig = (config as any).email

  const defaultFrom = emailConfig?.fromName
    ? `${emailConfig.fromName} <${emailConfig.from}>`
    : emailConfig?.from || 'noreply@example.com'

  const defaultReplyTo = emailConfig?.replyTo

  async function send(options: SendEmailOptions): Promise<SendEmailResult> {
    const startTime = Date.now()
    const nitroApp = useNitroApp()
    const recipient = Array.isArray(options.to) ? options.to[0] : options.to

    try {
      const driver = await getDriver()

      const from = options.fromName
        ? `${options.fromName} <${options.from || emailConfig?.from}>`
        : options.from || defaultFrom

      const payload: SendEmailPayload = {
        from,
        to: Array.isArray(options.to) ? options.to : [options.to],
        subject: options.subject,
        html: options.html,
        text: options.text,
        replyTo: options.replyTo || defaultReplyTo,
        cc: options.cc ? (Array.isArray(options.cc) ? options.cc : [options.cc]) : undefined,
        bcc: options.bcc ? (Array.isArray(options.bcc) ? options.bcc : [options.bcc]) : undefined,
        headers: options.headers,
        tags: options.tags,
      }

      const result = await driver.send(payload)

      await nitroApp.hooks.callHook('crouton:operation', {
        type: 'email:sent',
        source: 'crouton-email',
        metadata: {
          recipient,
          subject: options.subject,
          status: 'sent',
          duration: Date.now() - startTime,
          messageId: result.id,
        },
      })

      return { success: true, id: result.id }
    }
    catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error'
      console.error('[crouton-email] Failed to send email:', message)

      await nitroApp.hooks.callHook('crouton:operation', {
        type: 'email:failed',
        source: 'crouton-email',
        metadata: {
          recipient,
          subject: options.subject,
          status: 'failed',
          duration: Date.now() - startTime,
          error: message,
        },
      })

      return { success: false, error: message }
    }
  }

  async function sendBatch(emails: SendEmailOptions[]): Promise<SendEmailResult[]> {
    return Promise.all(emails.map(send))
  }

  return { send, sendBatch }
}

// Convenience singleton — preserves existing export
export const emailService = {
  send: (options: SendEmailOptions) => useEmailService().send(options),
  sendBatch: (emails: SendEmailOptions[]) => useEmailService().sendBatch(emails),
}
```

---

## Updated Types

Additions to `types/index.ts`. Existing types (`SendEmailOptions`, `SendEmailResult`, etc.) stay unchanged.

```ts
// --- New types ---

export type EmailDriverName = 'resend' | 'mailgun' | 'postmark' | 'brevo' | 'scaleway' | 'smtp'

export interface EmailConfig {
  /** Email driver (default: 'resend') */
  driver?: EmailDriverName
  /** API key for the provider */
  apiKey?: string
  /** Legacy: Resend API key (still supported, maps to apiKey when driver is resend) */
  resendApiKey?: string
  /** Mailgun: sending domain */
  domain?: string
  /** Mailgun: region ('eu' | 'us', default: 'eu') */
  region?: string
  /** Brevo: SMTP login */
  login?: string
  /** Scaleway: project ID */
  projectId?: string
  /** Scaleway: secret key */
  secretKey?: string
  /** SMTP: host */
  host?: string
  /** SMTP: port */
  port?: number
  /** SMTP: use TLS */
  secure?: boolean
  /** SMTP: auth credentials */
  auth?: { user: string; pass: string }
  /** From email address */
  from: string
  /** From display name */
  fromName?: string
  /** Default reply-to address */
  replyTo?: string
}

/** Internal payload passed to drivers (normalized from SendEmailOptions) */
export interface SendEmailPayload {
  from: string
  to: string[]
  subject: string
  html?: string
  text?: string
  replyTo?: string
  cc?: string[]
  bcc?: string[]
  headers?: Record<string, string>
  tags?: Array<{ name: string; value: string }>
}

/** Result from a driver's send() — just the message ID */
export interface SendEmailDriverResult {
  id: string
}

// --- Existing types (unchanged) ---
// SendEmailOptions — keeps headers, tags, fromName fields
// SendEmailResult — keeps { success, id?, error? }
// VerificationEmailOptions, MagicLinkEmailOptions, etc. — no changes
```

**Note on `headers` and `tags`**: These are Resend-specific features. The Resend driver passes them through. Other drivers silently ignore them. This is acceptable — these fields are optional and only used for tracking/analytics.

---

## Config Migration

### Before (current)

```ts
runtimeConfig: {
  email: {
    resendApiKey: process.env.RESEND_API_KEY,
    from: 'noreply@example.com',
    fromName: 'My App',
    replyTo: 'support@example.com',
  },
}
```

### After — still using Resend (zero-change upgrade)

Existing config works as-is. No `driver` field = defaults to `'resend'`. `resendApiKey` is auto-mapped to `apiKey` when driver is `resend`.

### After — explicit Resend (recommended)

```ts
runtimeConfig: {
  email: {
    driver: 'resend',
    apiKey: process.env.RESEND_API_KEY,
    from: 'noreply@example.com',
    fromName: 'My App',
    replyTo: 'support@example.com',
  },
}
```

### After — Mailgun EU

```ts
runtimeConfig: {
  email: {
    driver: 'mailgun',
    apiKey: process.env.MAILGUN_API_KEY,
    domain: process.env.MAILGUN_DOMAIN,
    from: 'noreply@example.com',
    fromName: 'My App',
    replyTo: 'support@example.com',
  },
}
```

### After — raw SMTP (Node.js VPS only)

```ts
runtimeConfig: {
  email: {
    driver: 'smtp',
    host: 'smtp.example.com',
    port: 587,
    secure: false,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
    from: 'noreply@example.com',
    fromName: 'My App',
  },
}
```

---

## Package.json Changes

```diff
  "dependencies": {
-   "resend": "^4.0.0",
    "@vitejs/plugin-vue": "^5.0.0",
    "vue-email": "^0.8.0"
  },
+ "optionalDependencies": {
+   "nodemailer": "^6.x.x"
+ },
+ "devDependencies": {
+   "@types/nodemailer": "^6.x.x"
+ }
```

- `resend` is removed — replaced by direct HTTP calls via `$fetch`
- `nodemailer` is optional — only needed for `driver: 'smtp'`
- `vue-email` and `@vitejs/plugin-vue` stay unchanged

---

## Testing

No tests exist currently. All tests are net-new.

### Unit Tests
- Driver factory resolution (correct driver loaded for each name)
- Each HTTP driver builds correct request (mock `$fetch`, assert URL/headers/body)
- SMTP driver dynamically imports nodemailer
- `resendApiKey` fallback mapping
- Error handling: unknown driver name, missing API key, API error responses
- `SendEmailResult` shape is always `{ success, id?, error? }`

### Integration Tests
- Send via Resend test API key
- Send via SMTP with [Ethereal](https://ethereal.email/) (nodemailer test accounts)
- All 5 convenience senders work through the new transport
- `crouton:operation` hooks fire with correct metadata
- `sendBatch()` sends multiple emails

### Consumer Tests
- `crouton-bookings` `getBookingEmailService()` still resolves correctly
- `crouton-auth` senders still work via `#crouton-email/server/utils/senders`

---

## Nuxt Config Changes

```ts
// nuxt.config.ts — updated runtime config defaults
runtimeConfig: {
  email: {
    driver: '',        // EMAIL_DRIVER (default: 'resend')
    apiKey: '',        // EMAIL_API_KEY
    resendApiKey: '',  // RESEND_API_KEY (legacy, auto-maps to apiKey)
    domain: '',        // MAILGUN_DOMAIN (mailgun)
    region: '',        // MAILGUN_REGION (mailgun, default: 'eu')
    login: '',         // BREVO_LOGIN (brevo)
    projectId: '',     // SCALEWAY_PROJECT_ID (scaleway)
    secretKey: '',     // SCALEWAY_SECRET_KEY (scaleway)
    host: '',          // SMTP_HOST (smtp)
    port: 0,           // SMTP_PORT (smtp)
    secure: false,     // SMTP_SECURE (smtp)
    from: '',          // EMAIL_FROM
    fromName: '',      // EMAIL_FROM_NAME
    replyTo: '',       // EMAIL_REPLY_TO
  },
}
```

---

## Downstream Consumers

| Package | Integration Point | Impact |
|---|---|---|
| `crouton-auth` | Emits `crouton:auth:email` Nitro hooks → `auth-email-listener.ts` dispatches to senders | None — senders unchanged |
| `crouton-bookings` | `getBookingEmailService()` → `useEmailService().send()` | None — SendEmailResult preserved |
| `crouton-bookings` | `CustomEmailProvider` / `registerEmailProvider()` | None — independent abstraction |
| `crouton-triage` | `fetchResendEmail()` via raw `fetch()` to Resend receiving API | None — separate concern (inbound, not outbound) |
| `crouton-ai` | `generate-email-template.post.ts` generates template HTML | None — templates are content, not transport |
| `crouton-mail` (future) | [Briefing](../briefings/crouton-mail-brief.md) builds on crouton-email as transport | Compatible — crouton-mail calls `useEmailService().send()` |

---

## CLI Integration

Email CLI commands (`crouton email test`, `crouton email verify-dns`) belong in the [EU hosting plan](./plan-crouton-eu-hosting.md) as deploy-time utilities alongside `crouton deploy push`, `crouton db backup`, etc. They are not part of this refactor.

The CLI lives at `packages/nuxt-crouton-cli/`, built with citty + unbuild. No `.croutonrc` config store exists — CLI reads from `.env`.

---

## Tasks

### Step 1 — Driver system
- [ ] Create `server/utils/drivers/` directory with `index.ts` (types)
- [ ] Implement `resend` driver (HTTP REST via `$fetch`)
- [ ] Implement `mailgun` driver (HTTP REST, EU region default)
- [ ] Implement `postmark` driver (HTTP REST)
- [ ] Implement `brevo` driver (HTTP REST)
- [ ] Implement `scaleway` driver (HTTP REST)
- [ ] Implement `smtp` driver (dynamic `import('nodemailer')`)
- [ ] Add new types to `types/index.ts` (`EmailDriverName`, `EmailConfig`, `SendEmailPayload`, `SendEmailDriverResult`)

### Step 2 — Refactor email.ts
- [ ] Replace Resend SDK import with driver resolution
- [ ] Preserve `send()` with exact `SendEmailResult` return type
- [ ] Preserve `sendBatch()`
- [ ] Preserve `crouton:operation` hooks with timing metadata
- [ ] Preserve `emailService` singleton export
- [ ] Add `resendApiKey` → `apiKey` fallback for backwards compat
- [ ] Lazy driver initialization (resolve on first send)

### Step 3 — Config + dependencies
- [ ] Update `nuxt.config.ts` runtime config defaults
- [ ] Remove `resend` from dependencies
- [ ] Add `nodemailer` to optionalDependencies
- [ ] Add `@types/nodemailer` to devDependencies

### Step 4 — Test
- [ ] Unit test each driver (mock `$fetch`)
- [ ] Unit test driver resolution + fallback logic
- [ ] Test with Resend (backwards compatibility)
- [ ] Test with Mailgun EU (primary EU use case)
- [ ] Test with Ethereal SMTP (Node.js runtime)
- [ ] Verify `crouton-bookings` integration
- [ ] Verify `crouton-auth` integration

### Step 5 — Docs
- [ ] Update `packages/crouton-email/CLAUDE.md` with new config shape + driver list
- [ ] Update `packages/crouton-email/README.md` with driver options and provider setup
- [ ] Add migration note for existing Resend users (zero-change upgrade path)
- [ ] Document runtime compatibility (HTTP drivers everywhere, SMTP Node.js only)

---

## Migration Guide (for existing users)

```markdown
## Migrating to multi-driver email

1. Update `@fyit/crouton-email` to latest

2. That's it. Your existing config works as-is.
   - No `driver` field = defaults to 'resend'
   - `resendApiKey` is auto-mapped internally
   - RESEND_API_KEY env var still works

3. To make it explicit (recommended):
   driver: 'resend',
   apiKey: process.env.RESEND_API_KEY,  // rename from resendApiKey

4. To switch providers, change `driver` and provider-specific config:
   driver: 'mailgun',
   apiKey: process.env.MAILGUN_API_KEY,
   domain: process.env.MAILGUN_DOMAIN,

5. All senders, templates, components, and auth integration
   work identically regardless of driver.
```

---

## Relationship to Other Plans

- **[EU Hosting Plan](./plan-crouton-eu-hosting.md)**: This refactor enables EU email providers for VPS self-hosting. CLI email commands live there.
- **[crouton-mail Brief](../briefings/crouton-mail-brief.md)**: Generic email template/trigger system built ON TOP of crouton-email as transport. The multi-driver refactor is step 1; crouton-mail is step 2.

---

## Future Scope (not now)

- Webhook handling for bounces/complaints (provider-specific)
- Email queue with retry (using Nitro tasks)
- DevTools panel showing sent emails in development
- `useEmailService().verify()` to test connection on startup
- Rate limiting per driver (respect provider limits)
