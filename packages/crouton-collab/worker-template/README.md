# Collab Worker Template

> **Normal path (#2693):** add `extends: ['@fyit/crouton-collab']` to the app and `"collab": true` to
> `apps/<app>/deploy.config.json`. The deploy workflow then deploys this Worker in place
> (`<app>-collab-staging`, `<app>-collab` in production, `<app>-pr<N>-collab` for PR previews), shares
> the app's `COLLAB_TOKEN_SECRET`, applies the D1 migration and builds the app with
> `NUXT_PUBLIC_COLLAB_WORKER_URL`. Everything below is the manual fallback.

Standalone Cloudflare Worker that hosts the `CollabRoom` Durable Object for real-time collaboration. Cloudflare Pages cannot host Durable Objects, so every app using `crouton-collab` in production needs a copy of this worker.

## Quick Start

### 1. Copy this template

```bash
cp -r packages/crouton-collab/worker-template workers/my-app-collab
```

### 2. Replace placeholders

In `wrangler.toml.template`, replace all `{{PLACEHOLDER}}` values and rename to `wrangler.toml`:

| Placeholder | Example | Description |
|---|---|---|
| `{{APP_NAME}}` | `my-app` | Your app name (used for worker name) |
| `{{D1_DATABASE_NAME}}` | `my-app-db` | D1 database name (same as Pages app) |
| `{{D1_DATABASE_ID}}` | `abc123-...` | D1 database ID (find via `wrangler d1 list`) |

```bash
cd workers/my-app-collab
cp wrangler.toml.template wrangler.toml
# Edit wrangler.toml and replace placeholders
```

Also update `package.json` — replace `{{APP_NAME}}` in the name field.

### 3. Update the import path

In `src/index.ts`, verify the relative import path to `CollabRoom` is correct for your project structure. If you placed the worker at `workers/my-app-collab/`, the default path (`../../server/durable-objects/CollabRoom` in place; adjust it when copied elsewhere) should work for a standard monorepo layout.

### 4. Configure allowed origins

In `src/index.ts`, add your app's domains to `ALLOWED_ORIGINS`:

```typescript
const ALLOWED_ORIGINS = [
  'https://my-app.pages.dev',
  'https://my-app.example.com',
  'http://localhost:3000',
]
```

Leaving the array empty allows all origins (useful for development).

### 5. Set the shared secret

The worker and your Pages app must share the same `COLLAB_TOKEN_SECRET` for token-based auth:

```bash
cd workers/my-app-collab
npx wrangler secret put COLLAB_TOKEN_SECRET
# Paste the same secret used in your Pages app
```

### 6. Run the D1 migration (first time only)

Create the `yjs_collab_states` table in your D1 database:

```bash
npx wrangler d1 execute {{D1_DATABASE_NAME}} --remote \
  --file=./packages/crouton-collab/server/database/migrations/0001_yjs_collab_states.sql
```

### 7. Deploy

```bash
cd workers/my-app-collab
pnpm install
npx wrangler deploy
```

### 8. Configure your Pages app

Set the worker URL as an environment variable in your Pages app (build-time, baked into client bundle):

```bash
NUXT_PUBLIC_COLLAB_WORKER_URL=https://my-app-collab.workers.dev
```

Your Pages app also needs a `script_name` reference in its `wrangler.toml`:

```toml
[[durable_objects.bindings]]
name = "COLLAB_ROOMS"
class_name = "CollabRoom"
script_name = "my-app-collab"
```

## Deploy Order

1. Deploy this collab worker first (Pages app references it via `script_name`)
2. Run D1 migration (first time only)
3. Deploy Pages app with `NUXT_PUBLIC_COLLAB_WORKER_URL` set

## How It Works

```
Client Browser
  |  wss://my-app-collab.workers.dev/{roomKey}/ws?token=...
  v
Collab Worker (this worker)
  |  Routes /{roomKey}/{action} to correct DO instance
  v
CollabRoom Durable Object
  |-- WebSocket sync (Yjs CRDTs)
  |-- Awareness/presence
  |-- DO storage (fast) + D1 (durable)
  +-- Auth: HMAC token verification
```

The client connects directly to this worker (not through Nitro) because Nitro cannot proxy WebSocket frames. Auth is handled via HMAC-signed tokens that the Pages app issues at `/api/collab/token`.

## Local Development

In local dev, you typically don't need this worker. The `crouton-collab` package includes a crossws handler at `/api/collab/[roomId]/ws` that runs in-process. This worker is only needed for production on Cloudflare.

To test locally with wrangler:

```bash
cd workers/my-app-collab
npx wrangler dev
```
