# Deploying a Crouton App to Cloudflare Pages

> ⚠️ **Superseded (kept for history).** Crouton apps now deploy to **Cloudflare Workers
> (static assets) with auto-provisioning**, not Pages (#108/#114), under the two-domain
> topology (production → `friendlyinter.net`, staging → `pmcp.dev`; #133). Current,
> canonical instructions live in **the `crouton-ci-and-deploy-map` skill → "NuxtHub's role + deploy anatomy"** and the
> **`/deploy` skill** (`.claude/skills/deploy/SKILL.md`). triage/velo/fanfare are migrated.
> This Pages-era guide is retained only for historical reference.

This guide documents how to deploy a Nuxt Crouton app (like `apps/velo`) to Cloudflare Pages with D1 database and R2 blob storage. It's based on hard-won lessons from deploying velo to production.

## Architecture Overview

```
Cloudflare Pages          (hosting — static + SSR via Workers)
  + D1                    (SQLite database)
  + R2                    (blob/file storage)
  + NuxtHub module        (abstracts D1/R2 bindings — NOT used for hosting)
```

NuxtHub is a **Nuxt module only** — it provides `useDrizzle()`, `hubBlob()`, etc. as abstractions over Cloudflare bindings. Hosting and deployment is done directly via Wrangler + Cloudflare Pages.

## Prerequisites

```bash
npm install -g wrangler
wrangler login
```

## Step 1: Create Cloudflare Resources

```bash
# Create a Pages project (or let first deploy create it)
npx wrangler pages project create my-app

# Create D1 databases
npx wrangler d1 create my-app-db              # production
npx wrangler d1 create my-app-staging-db       # staging

# Create R2 buckets
npx wrangler r2 bucket create my-app-blob
npx wrangler r2 bucket create my-app-staging-blob
```

Save the D1 database IDs from the output — you'll need them for `wrangler.jsonc`.

## Step 2: Configure wrangler.jsonc

Use `.jsonc` (not `.toml`) — NuxtHub reads this format and Nitro copies it into the build output.

```jsonc
{
  "name": "my-app",
  "compatibility_date": "2024-09-02",
  "compatibility_flags": ["nodejs_compat"],
  "pages_build_output_dir": "dist",

  // Production bindings
  "d1_databases": [
    {
      "binding": "DB",
      "database_name": "my-app-db",
      "database_id": "<your-production-db-id>",
      "migrations_dir": "server/db/migrations/sqlite"
    }
  ],
  "r2_buckets": [
    { "binding": "BLOB", "bucket_name": "my-app-blob" }
  ],

  // Staging environment overrides
  // NOTE: bindings do NOT inherit — must be specified fully per env
  "env": {
    "preview": {
      "d1_databases": [
        {
          "binding": "DB",
          "database_name": "my-app-staging-db",
          "database_id": "<your-staging-db-id>",
          "migrations_dir": "server/db/migrations/sqlite"
        }
      ],
      "r2_buckets": [
        { "binding": "BLOB", "bucket_name": "my-app-staging-blob" }
      ]
    }
  }
}
```

**Critical**: The `env` block is needed for staging migrations (`--env preview`) and NuxtHub build (`CLOUDFLARE_ENV=preview`), but causes a deploy error — see the Wrangler Bug section below.

## Step 3: Configure nuxt.config.ts

```typescript
export default defineNuxtConfig({
  modules: ['@fyit/crouton'],
  extends: [
    '@fyit/crouton-core',
    // ... your layers
  ],

  // NuxtHub — module only, NOT hosting
  hub: {
    blob: true,
    db: 'sqlite'       // NEVER use `database: true`
  },

  // Disable features incompatible with Cloudflare Workers
  ogImage: { enabled: false },       // saves ~4MB bundle size
  croutonAuth: {
    methods: { passkeys: false }     // tsyringe doesn't work on CF Workers
  },

  // Stub out passkey/WebAuthn dependencies
  nitro: {
    alias: {
      '@better-auth/passkey/client': resolve(cfStubs, 'client'),
      '@better-auth/passkey': cfStubs,
      'tsyringe': cfStubs,
      'reflect-metadata': cfStubs,
      '@peculiar/x509': cfStubs,
      '@simplewebauthn/server': cfStubs,
      'papaparse': cfStubs        // if not needed server-side
    }
  },

  // Route rules for performance
  routeRules: {
    '/_nuxt/**': { headers: { 'cache-control': 'public, max-age=31536000, immutable' } },
    '/auth/login': { prerender: true },
    '/admin/**': { headers: { 'cache-control': 'no-store' } },
  },
})
```

**Do NOT hardcode** `nitro.preset: 'cloudflare-pages'` — NuxtHub auto-detects the provider. Hardcoding it breaks local dev by forcing the D1 driver instead of local SQLite.

## Step 4: Set Cloudflare Secrets

Secrets are set via Wrangler or the Cloudflare Dashboard. They're available **at runtime only** (not build time).

```bash
# Required
npx wrangler pages secret put BETTER_AUTH_SECRET
npx wrangler pages secret put BETTER_AUTH_URL        # e.g. https://my-app.pages.dev

# Optional — email
npx wrangler pages secret put NUXT_EMAIL_RESEND_API_KEY
npx wrangler pages secret put NUXT_EMAIL_FROM
npx wrangler pages secret put NUXT_EMAIL_FROM_NAME

# Optional — maps
npx wrangler pages secret put NUXT_MAPBOX_ACCESS_TOKEN        # server-side
npx wrangler pages secret put NUXT_PUBLIC_MAPBOX_ACCESS_TOKEN  # client-side
```

## Step 5: Deploy

### Manual deploy

```bash
# Production
NITRO_PRESET=cloudflare-pages nuxt build
npx wrangler pages deploy dist/

# Staging
NITRO_PRESET=cloudflare-pages CLOUDFLARE_ENV=preview nuxt build
npx wrangler pages deploy dist/ --branch staging
```

### Database migrations

```bash
# Production
npx wrangler d1 migrations apply DB --remote

# Staging
npx wrangler d1 migrations apply DB --env preview --remote

# Local dev
npx wrangler d1 migrations apply my-app-db --local
```

---

## Lessons Learned (Pitfalls & Fixes)

### 1. Environment Variables: NUXT_ Prefix Required on Cloudflare

**Problem**: `useRuntimeConfig()` returns empty strings for secrets like `RESEND_API_KEY`.

**Why**: Cloudflare Pages secrets are only available at **runtime**, not build time. Nuxt auto-maps `NUXT_`-prefixed vars to `runtimeConfig`, but plain names (e.g., `RESEND_API_KEY`) only work locally via `process.env` at build time.

**Fix**: Use the `NUXT_`-prefixed naming convention for all Cloudflare secrets:

| Local `.env` (build time) | Cloudflare secret (runtime) | runtimeConfig path |
|---|---|---|
| `RESEND_API_KEY` | `NUXT_EMAIL_RESEND_API_KEY` | `email.resendApiKey` |
| `MAPBOX_TOKEN` | `NUXT_MAPBOX_ACCESS_TOKEN` | `mapboxAccessToken` |

Both naming conventions can coexist in `.env` for local dev. On Cloudflare, only the `NUXT_`-prefixed version works.

### 2. useRuntimeConfig(event) — Always Pass the Event

**Problem**: `useRuntimeConfig()` without the H3 event returns **build-time defaults** (empty strings) on Cloudflare Workers.

**Why**: Cloudflare Workers don't have `process.env`. Runtime config comes from the request's execution context, accessed via the H3 event.

**Fix**: Always pass `event` in server routes:

```typescript
// In API handlers — event is the first parameter
export default defineEventHandler(async (event) => {
  const config = useRuntimeConfig(event)  // returns runtime secrets
})

// In utility functions called from handlers — thread the event through
async function sendEmail(event: H3Event, to: string) {
  const config = useRuntimeConfig(event)
  // ...
}

// In code where event isn't directly available (after async boundaries)
import { useEvent } from 'h3'
const event = useEvent()  // resolves from Nitro's async context
const config = useRuntimeConfig(event)
```

**Warning**: `useEvent()` can fail after `dynamic import()` or `Promise.all()` which break AsyncLocalStorage context on CF Workers. Prefer threading `event` explicitly.

### 3. Wrangler 4.64+ Rejects env Blocks in Redirected Configs

**Problem**: `wrangler pages deploy` fails with "environments are not supported in redirected configurations".

**Why**: Nitro copies the full `wrangler.jsonc` (including `env` blocks) into `dist/_worker.js/wrangler.json`. Wrangler 4.64+ rejects `env` blocks in these "redirected" configs. This is a [Nitro bug](https://github.com/nitrojs/nitro/issues/3429).

**Fix**: Post-build step strips `env` from the redirected config:

```bash
CONFIG="dist/_worker.js/wrangler.json"
if [ -f "$CONFIG" ] && grep -q '"env"' "$CONFIG"; then
  node -e "
    const fs = require('fs');
    const cfg = JSON.parse(fs.readFileSync('$CONFIG', 'utf8'));
    delete cfg.env;
    fs.writeFileSync('$CONFIG', JSON.stringify(cfg, null, 2));
  "
fi
```

Keep the `env` block in the **source** `wrangler.jsonc` — it's needed for staging migrations and NuxtHub build.

### 4. Don't Hardcode nitro.preset

**Problem**: Setting `nitro: { preset: 'cloudflare-pages' }` in `nuxt.config.ts` causes "DB binding not found" errors in local dev.

**Why**: NuxtHub auto-detects the provider via `std-env`. Hardcoding forces the D1 driver instead of local SQLite.

**Fix**: Set the preset via environment variable only during deploy:

```bash
NITRO_PRESET=cloudflare-pages nuxt build
```

### 5. hub: { db: 'sqlite' } — Never database: true

**Problem**: `hub: { database: true }` causes "Cannot resolve entry module .nuxt/hub/db/schema.entry.ts" and migration failures.

**Fix**: Always use `hub: { db: 'sqlite' }`.

### 6. Passkeys / WebAuthn Don't Work on CF Workers

**Problem**: `tsyringe` (dependency injection used by `@better-auth/passkey`) requires `reflect-metadata` which doesn't work on CF Workers.

**Fix**: Disable passkeys and stub out the dependencies:

```typescript
// nuxt.config.ts
croutonAuth: { methods: { passkeys: false } },
nitro: {
  alias: {
    '@better-auth/passkey/client': cfStubs + '/client',
    '@better-auth/passkey': cfStubs,
    'tsyringe': cfStubs,
    'reflect-metadata': cfStubs,
    '@peculiar/x509': cfStubs,
    '@simplewebauthn/server': cfStubs,
  }
}
```

Create stub files that export no-ops (see `apps/velo/server/utils/_cf-stubs/`).

### 7. D1 Has a 100-Parameter Limit Per Query

**Problem**: Queries with 100+ bound parameters fail silently or throw errors.

**Fix**: Chunk `inArray()` queries into batches of 100:

```typescript
const chunks = []
for (let i = 0; i < ids.length; i += 100) {
  chunks.push(ids.slice(i, i + 100))
}
const results = await Promise.all(
  chunks.map(chunk => db.select().from(table).where(inArray(table.id, chunk)))
)
return results.flat()
```

### 8. SSR-Unsafe Patterns

Several patterns that work in SPA mode break under SSR on Cloudflare:

| Pattern | Problem | Fix |
|---|---|---|
| `localStorage` | Not available during SSR | `useCookie()` or VueUse `useLocalStorage()` |
| Module-level `ref()` | Shared across requests | `useState()` |
| `process.client` | Deprecated | `import.meta.client` |
| `new Function()` | Blocked by CSP on Workers | Use `jiti` for config loading |
| Raw `fetch()` | Doesn't integrate with Nuxt | `$fetch` |

### 9. Route Rules: Wildcards Can Break API Routing

**Problem**: SWR route rules like `'/api/teams/*/pages'` caused ALL `/api/teams/:id/*` collection routes to return 404.

**Why**: The wildcard `*` in route rules conflicts with radix3's `:id` parameter routing.

**Fix**: Be specific with route rules. Don't use wildcards that overlap with parameterized API routes:

```typescript
// BAD — breaks all /api/teams/:id/* routes
'/api/teams/*/pages/**': { swr: 600 },

// GOOD — target specific public endpoints
'/api/crouton-bookings/teams/*/availability': { swr: 300 },
```

### 10. @nuxthub/core Version Conflicts

**Problem**: Layer packages with outdated `@nuxthub/core` peer deps (0.7.x, 0.8.x) can get hoisted over the correct 0.10+ version, breaking `hub:db` auto-imports.

**Fix**: Ensure `crouton-core` has `@nuxthub/core` as an **explicit dependency** (not just peer). Remove redundant/outdated peer deps from other packages.

---

## CI/CD: GitHub Actions Workflow

Per-app callers were retired (#481): every `apps/<name>` now deploys via the single generic
`.github/workflows/deploy-apps.yml`, which reads each app's `apps/<name>/deploy.config.json`
(`stagingUrl` / `productionUrl` / `layerPackages` / `watchPaths`) and fans out to the reusable
`.github/workflows/deploy-app.yml`. See those two files for the full reference. Key points:

1. **Path filters** — only deploy when relevant packages change
2. **Layer caching** — cache built layer packages across runs
3. **Nuxt build cache** — cache `.nuxt/cache` and `node_modules/.cache`
4. **Build order** — layer packages must be built before the app
5. **Env-aware build** — `CLOUDFLARE_ENV=preview` for staging, empty for production
6. **BETTER_AUTH_URL** — must be set at build time (not just runtime)
7. **Strip env block** — post-build workaround for Wrangler bug
8. **Branch-based deploy** — `--branch staging` for preview, no branch flag for production

### Required GitHub Secrets

| Secret | Description |
|---|---|
| `CLOUDFLARE_ACCOUNT_ID` | Your Cloudflare account ID |
| `CLOUDFLARE_API_TOKEN` | API token with Pages + D1 + R2 permissions |

---

## Syncing Production Data to Local Dev

Use the `crouton db-pull` command:

```bash
# Pull production data
npx crouton db-pull

# Pull staging data
npx crouton db-pull --env preview
```

This replaces the manual export/clear/import workflow with a single command.

---

## Cloudflare Limitations Summary

| Feature | Status | Workaround |
|---|---|---|
| Passkeys/WebAuthn | Not supported | Email/password or OAuth |
| OG Image generation | Not supported | Disable or use static images |
| Long-running tasks | 30s CPU limit | Cloudflare Queues or Durable Objects |
| `reflect-metadata` | Not supported | Stub out |
| D1 query params | Max 100 per query | Chunk into batches |
| `process.env` | Not available at runtime | Use `useRuntimeConfig(event)` |
| Large bundles | ~25MB limit | Disable ogImage, stub unused deps |
