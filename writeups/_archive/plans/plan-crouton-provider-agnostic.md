> 🗄️ **Archived 2026-11-04 (#3352) — dropped:** https://github.com/FriendlyInternet/nuxt-crouton/issues/1636 and https://github.com/FriendlyInternet/nuxt-crouton/issues/1634 were closed not planned. Historical record, not current guidance.

# Crouton Provider-Agnostic Deploy Plan

## Summary

Make crouton deployable to **any infrastructure provider** without code changes. NuxtHub v0.10 already abstracts DB/blob/KV via env vars. This plan removes the remaining Cloudflare-specific dependencies, adds VPS deploy tooling, abstracts real-time collaboration, and documents provider recipes.

Cloudflare remains a first-class option. The goal is **choice, not migration**.

**Related**: The [email refactor plan](./plan-crouton-email-refactor.md) enables EU email providers (Mailgun EU, Brevo, Scaleway TEM) for VPS deployments.

---

## How It Works

```
crouton app code (identical)
       |
       |-- NITRO_PRESET=cloudflare-pages --> wrangler deploy
       |      D1, R2, KV, DO -- all via Cloudflare bindings
       |
       +-- NITRO_PRESET=node-server --> crouton deploy push
              libsql, S3, Redis, y-websocket -- all via env vars
```

**Zero code changes between providers.** Same `useDB()`, same `blob.put()`, same composables. Only `.env` and deploy command differ.

---

## Current Cloudflare Dependencies

| Dependency | Where | NuxtHub Abstracts? | Fix |
|---|---|---|---|
| D1 (SQLite) | All packages via `useDB()` | Yes | None needed |
| R2 (blob) | crouton-assets, crouton-core | Yes | None needed |
| KV | crouton-triage | Yes | None needed |
| Pages (compute) | All apps | No | Phase 1 |
| Durable Objects | crouton-collab, crouton-flow | No | Phase 3 |
| Wrangler CLI | Deploy workflows, migrations | No | Phase 2 |
| `DrizzleD1Database` type | crouton-auth | No | Phase 0 |
| `hubDatabase()` | crouton-auth (2 calls) | No | Phase 0 |
| Passkey stubs | crouton-auth | No | Phase 1 |

---

## Provider Recipes

| Layer | Cloudflare | Hetzner | Scaleway | Any VPS |
|---|---|---|---|---|
| **Compute** | Pages/Workers | VPS (CX22: 2vCPU/4GB, ~E3.49/mo) | Instance (DEV1-S, ~E5/mo) | Any Linux server |
| **Database** | D1 | SQLite on disk (libsql) | SQLite on disk (libsql) | SQLite on disk |
| **Blob Storage** | R2 (zero egress) | Object Storage (S3, ~E4.99/mo) | Object Storage (S3) | Any S3-compatible |
| **KV + Cache** | KV | Redis (on VPS, free) | Managed Redis or on VPS | Redis |
| **DNS** | Cloudflare DNS (best) | Cloudflare DNS | Cloudflare DNS | Cloudflare DNS |
| **Domains** | Cloudflare Registrar (at-cost) | Cloudflare Registrar | Cloudflare Registrar | Any registrar |
| **Email (outbound)** | Resend | Scaleway TEM / Brevo | Scaleway TEM (EU-native) | Any SMTP/API |
| **Email (inbound)** | Email Routing (free) | CF Email Routing | CF Email Routing | Any forwarder |
| **CDN** | Built-in (300+ PoPs) | Bunny.net (~E1/mo) | Scaleway CDN (65 PoPs) | Bunny.net |
| **SSL** | Edge certs (auto) | Caddy (Let's Encrypt) | Caddy (Let's Encrypt) | Caddy |
| **Real-time collab** | Durable Objects | y-websocket (Phase 3) | y-websocket (Phase 3) | y-websocket |
| **AI** | Any API | Mistral (EU) / Any | Scaleway GenAI / Any | Any API |
| **Analytics** | CF Analytics | Plausible (EU) | Plausible (EU) | Plausible |
| **Approx. cost** | Free tier / pay-per-use | ~E8.50/mo | ~E12/mo | Varies |

**Note on DNS/Domains**: Cloudflare DNS is recommended regardless of compute provider. Domain registration is the least sticky service -- easy to transfer away. At-cost pricing and best-in-class performance make it the pragmatic choice even in an EU-sovereign stack.

### Email Provider Comparison

| Provider | Location | Free Tier | Paid | EU Data Residency |
|---|---|---|---|---|
| Resend | US | 3k/mo | $20/mo for 50k | No |
| Scaleway TEM | France | 300/mo | E0.25/1k | Yes |
| Brevo | France | 300/day | E9/mo for 5k | Yes |
| Mailgun (EU) | US (EU region) | Trial only | $15/mo for 10k | Partial |
| Postmark | US | 100/mo | $15/mo for 10k | No |
| AWS SES | US (EU region) | 62k/mo (EC2) | $0.10/1k | Partial |

crouton-email's multi-driver design means switching is a `.env` change, not a code change.

### Cloudflare vs VPS Trade-offs

| | Cloudflare | VPS (Hetzner/Scaleway/etc) |
|---|---|---|
| Global edge | 300+ PoPs | Single datacenter |
| DDoS protection | Enterprise-grade | Basic (add Bunny CDN for more) |
| Auto-scaling | Unlimited | Manual (resize VPS) |
| Real-time collab | Durable Objects (built-in) | y-websocket (Phase 3) |
| Maintenance | Zero | You manage Node + OS updates |
| **Data sovereignty** | **US company** | **EU only (Hetzner/Scaleway)** |
| **SQLite** | **Over network (D1)** | **On disk, zero latency** |
| **WebSockets** | **Durable Objects (complex)** | **Native (simple)** |
| **Cron** | **Cron Triggers + wrangler** | **Nitro scheduledTasks, just works** |
| **Passkeys** | **Broken (needs stubs)** | **Native Node.js, just works** |
| **Email** | **HTTP API only (Resend)** | **Any provider (HTTP + SMTP)** |
| **Cost at low scale** | **Free tier** | **~E8-12/mo** |
| **Multiple projects** | **Per-project billing** | **All on one VPS** |

For EU-focused CRUD apps, VPS wins on simplicity, latency, and cost. Cloudflare wins for global distribution, zero-ops, and real-time collaboration.

---

## Codebase Alignment (verified against repo)

### What already works
- **NuxtHub v0.10 multi-vendor**: S3 blob (`aws4fetch`), Redis KV/cache (`ioredis`), libsql SQLite all supported. Auto-detects from env vars -- no nuxt.config changes needed.
- **Database access**: Migrated to `hub:db` auto-imports (`useDB()`). Only 2 legacy `hubDatabase()` calls remain.
- **Schema directories**: Packages use `server/database/schema/`, apps aggregate via `server/db/schema.ts`. Both work with NuxtHub v0.10.
- **Generator templates**: Already emit `useDB()`, not `hubDatabase()`.
- **Package scope**: `@fyit/*` throughout.

### What needs fixing (small)
- `crouton-auth/server/lib/auth.ts`: `DrizzleD1Database` type -- change to generic drizzle type (~1 line)
- `crouton-auth/server/utils/team.ts`: 2x `hubDatabase()` + `drizzle(d1)` -- replace with `useDB()` (~10 lines)
- `crouton-triage/server/services/userMapping.ts`: 2x `useDrizzle()` -- dead code (~2 lines)
- `@nuxthub/core` peer deps: Should declare `peerDependencies: ">=0.10.0"` in packages that use `hub:db`

### VPS Compatibility Matrix

| Package | VPS | Cloudflare | Notes |
|---------|-----|------------|-------|
| crouton-core | Yes | Yes | Foundation -- works everywhere |
| crouton-auth | Yes | Yes | Passkeys work natively on VPS |
| crouton-bookings | Yes | Yes | Email scheduling needs `node-server` |
| crouton-email | Yes | Yes | SMTP driver only on VPS |
| crouton-i18n | Yes | Yes | |
| crouton-pages | Yes | Yes | |
| crouton-assets | Yes | Yes | Blob via S3 on VPS |
| crouton-ai | Yes | Yes | |
| crouton-maps | Yes | Yes | |
| crouton-collab | Phase 3 | Yes | Needs Durable Objects today, y-websocket later |
| crouton-flow | Phase 3 | Yes | Depends on crouton-collab |
| crouton-triage | Yes | Yes | KV via Redis on VPS |
| crouton-admin | Yes | Yes | |

---

## NuxtHub v0.10 Configuration

The nuxt.config.ts doesn't change between providers. NuxtHub auto-detects drivers from env vars.

```ts
// nuxt.config.ts -- same for ALL providers
export default defineNuxtConfig({
  hub: {
    db: 'sqlite',   // CF: D1 via bindings. VPS: libsql at .data/db/sqlite.db
    blob: true,      // CF: R2 via bindings. VPS: auto-detects S3_* env vars
    kv: true,        // CF: KV via bindings. VPS: auto-detects REDIS_URL
    cache: true,     // CF: KV via bindings. VPS: auto-detects REDIS_URL, falls back to fs
  },
})
```

```bash
# .env (VPS only -- Cloudflare uses wrangler bindings instead)
S3_ACCESS_KEY_ID=xxx
S3_SECRET_ACCESS_KEY=xxx
S3_BUCKET=my-app
S3_REGION=eu-central-1
S3_ENDPOINT=https://fsn1.your-objectstorage.com
REDIS_URL=redis://localhost:6379
BETTER_AUTH_SECRET=xxx
BETTER_AUTH_URL=https://myapp.example.com
```

**Required packages for VPS**: `pnpm add aws4fetch ioredis`

Note: `crouton-core` already configures `hub: { db: 'sqlite' }` and forces `blob: true` via the `ensure-hub-blob` module.

---

## Phases

### Phase 0 -- Remove Hardcoded CF References (~1 hour)

- [ ] Fix `DrizzleD1Database` type in `crouton-auth/server/lib/auth.ts` (~1 line)
- [ ] Replace `hubDatabase()` calls in `crouton-auth/server/utils/team.ts` (~10 lines)
- [ ] Fix dead `useDrizzle()` calls in `crouton-triage` (~2 lines)
- [ ] Email multi-driver refactor (see [email plan](./plan-crouton-email-refactor.md))

### Phase 1 -- Preset-Agnostic Build (~1 day)

- [ ] Make Nitro preset configurable via env var (default: `cloudflare-pages`)
- [ ] Ensure passkey stubs only activate on Cloudflare (they break Node.js)
- [ ] Verify all packages build with `NITRO_PRESET=node-server`
- [ ] Test full app lifecycle: build, migrate, run on `node-server`
- [ ] Create VPS-specific `.env.example` template

### Phase 2 -- VPS Deploy Tooling (~3-5 days)

#### Templates (in `packages/crouton-cli/templates/deploy/`)
- [ ] `Caddyfile` -- reverse proxy with auto HTTPS
- [ ] `Dockerfile` -- multi-stage Node.js build
- [ ] `docker-compose.yml` -- app + Redis + Caddy (advanced)
- [ ] `.env.example` -- all required environment variables
- [ ] `systemd/crouton-app.service` -- systemd unit template
- [ ] GitHub Actions deploy workflow template

#### CLI Commands
- [ ] Add `execa` dependency to crouton-cli
- [ ] `crouton deploy init` -- server setup wizard (SSH-based)
- [ ] `crouton deploy setup <app>` -- per-app setup
- [ ] `crouton deploy push [--env]` -- build + rsync + restart
- [ ] `crouton deploy logs` -- tail remote logs
- [ ] `crouton deploy env set/list` -- manage env vars
- [ ] `crouton db backup` / `restore` / `download`
- [ ] `crouton email test` / `verify-dns`
- [ ] `.crouton/deploy.json` config with multi-environment support

#### Documented Recipes
- [ ] `server/tasks/backup/sqlite.ts` -- hourly blob storage backup (VPS only)
- [ ] `server/tasks/email/send-scheduled.ts` -- daily reminder/follow-up emails
- [ ] Restore utility or CLI command

### Phase 3 -- Collab Abstraction (~2 weeks)

Make crouton-collab work without Durable Objects.

#### Architecture

```
Current (Cloudflare):
  Client -- WebSocket -- Durable Object (CollabRoom)
                              |-- DurableObjectStorage (Yjs doc persistence)
                              |-- blockConcurrencyWhile() (no race conditions)

Target (VPS):
  Client -- WebSocket -- y-websocket server (Node.js)
                              |-- SQLite (Yjs doc persistence)
                              |-- Redis pub/sub (multi-process sync, optional)
```

#### CollabProvider Interface

```typescript
interface CollabProvider {
  createRoom(docId: string): CollabRoom
  onConnect(ws: WebSocket, room: CollabRoom): void
  onMessage(ws: WebSocket, room: CollabRoom, msg: Uint8Array): void
  persistence: YDocPersistence
}

// Implementation 1: CloudflareCollabProvider (existing DO-based)
// Implementation 2: NodeCollabProvider (y-websocket + Redis + SQLite)
```

#### What Changes Without Durable Objects

| Capability | Durable Objects | y-websocket |
|---|---|---|
| Scaling | Auto-creates one DO per document | Single Node.js process |
| Hibernation | Sleeps when idle, zero cost | Process stays running |
| Edge routing | Runs near first client | Single server location |
| Concurrency | Built-in guarantees | Single-process OK; multi-process needs Redis |
| Ops burden | Zero | Manage WebSocket connections, restarts |
| **Portability** | **Cloudflare only** | **Runs anywhere** |
| **Debugging** | **Opaque** | **Standard Node.js** |
| **Cost at scale** | **Per-request billing** | **Fixed cost on VPS** |

#### Tasks
- [ ] Define `CollabProvider` interface
- [ ] Extract current DO logic into `CloudflareCollabProvider`
- [ ] Build `NodeCollabProvider` using y-websocket
- [ ] Add Yjs doc persistence to SQLite
- [ ] Caddy config for `wss://` WebSocket upgrade
- [ ] Redis pub/sub for multi-process (optional, not needed initially)
- [ ] Test: conflict resolution, reconnection, offline sync

### Phase 4 -- Documentation (~2 days)

- [ ] Provider-agnostic deploy guide (primary)
- [ ] Hetzner-specific recipe
- [ ] Scaleway-specific recipe
- [ ] Generic VPS recipe
- [ ] Cloudflare deploy guide (update existing)
- [ ] Multi-project guide (advanced)
- [ ] Backup & restore guide
- [ ] Email provider DNS setup guide (SPF/DKIM/DMARC)
- [ ] VPS compatibility matrix

### Phase 5 -- Validate

- [ ] Fresh deploy on Hetzner following only docs
- [ ] Fresh deploy on Scaleway following only docs
- [ ] Test 3+ projects on one VPS
- [ ] Test backup + restore cycle
- [ ] Test Nitro scheduled tasks
- [ ] Verify NuxtHub blob with Hetzner Object Storage
- [ ] Verify NuxtHub blob with Scaleway Object Storage
- [ ] Test email with Scaleway TEM
- [ ] Test collab on VPS with y-websocket (Phase 3 dependent)

---

## VPS Architecture

```
VPS (Hetzner / Scaleway / any)
|-- Caddy (reverse proxy, auto SSL)
|   |-- app1.example.com --> :3001
|   |-- app2.example.com --> :3002
|   +-- app3.example.com --> :3003
|-- Nuxt apps (node-server preset)
|   |-- NuxtHub v0.10 (db, blob, kv, cache -- env var driven)
|   +-- Nitro scheduled tasks (email, backups)
|-- Redis (shared across apps)
|-- SQLite files on disk (per app)
+-- Nitro backup task --> Object Storage

Object Storage (S3-compatible, any provider)
|-- Blob storage (user uploads, per app prefix)
+-- SQLite backups (per app prefix)
```

**Primary path: Bare Node + Caddy.** Docker Compose is the documented advanced option.

**Backups: Nitro scheduled task.** Uses `blob.put()` to stay provider-agnostic.

---

## Deploy Paths

### Path A: Bare Node + Caddy (primary, VPS)

```bash
# On server
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo bash -
sudo apt install -y nodejs caddy

# Deploy
pnpm build
node .output/server/index.mjs
```

Caddyfile:
```
app.example.com {
    reverse_proxy localhost:3000
}
```

Systemd service:
```ini
[Unit]
Description=My Crouton App
After=network.target

[Service]
Type=simple
User=deploy
WorkingDirectory=/opt/apps/my-app
ExecStart=/usr/bin/node .output/server/index.mjs
Restart=always
EnvironmentFile=/opt/apps/my-app/.env

[Install]
WantedBy=multi-user.target
```

### Path B: Docker Compose (advanced, VPS)

```yaml
services:
  app:
    build: .
    ports:
      - "3000:3000"
    environment:
      - REDIS_URL=redis://redis:6379
      - S3_ENDPOINT=${S3_ENDPOINT}
      - S3_BUCKET=${S3_BUCKET}
      - S3_ACCESS_KEY_ID=${S3_ACCESS_KEY_ID}
      - S3_SECRET_ACCESS_KEY=${S3_SECRET_ACCESS_KEY}
    volumes:
      - app-data:/app/.data
    depends_on:
      - redis
    restart: unless-stopped

  redis:
    image: redis:7-alpine
    volumes:
      - redis-data:/data
    restart: unless-stopped

  caddy:
    image: caddy:2-alpine
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile
      - caddy-data:/data
    restart: unless-stopped

volumes:
  app-data:
  redis-data:
  caddy-data:
```

Dockerfile:
```dockerfile
FROM node:20-alpine AS build
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN corepack enable && pnpm install --frozen-lockfile
COPY . .
RUN pnpm build

FROM node:20-alpine
WORKDIR /app
COPY --from=build /app/.output .output
EXPOSE 3000
CMD ["node", ".output/server/index.mjs"]
```

### Path C: Cloudflare (existing)

Already configured and working. Deploy via GitHub CI + `wrangler pages deploy`. `wrangler.jsonc` files exist in all deployed apps. No changes needed.

---

## Multi-Project on One VPS

Killer feature vs Cloudflare (per-project billing). One VPS runs 6-8 crouton projects.

**Note**: This is about running *different crouton projects* on one VPS. Multi-tenancy (multiple teams) is already built into every crouton app via `useTeamContext()`.

Caddyfile for multi-project:
```
app1.example.com {
    reverse_proxy localhost:3001
}

app2.example.com {
    reverse_proxy localhost:3002
}
```

Each project gets its own port, SQLite file, `.env`, and systemd service. They share Redis, Object Storage bucket (different key prefixes), and Caddy.

---

## Nitro Scheduled Tasks

Two recipes -- not shipped in crouton-core, since backup is VPS-only and email scheduling is bookings-specific.

```ts
// nuxt.config.ts
nitro: {
  experimental: { tasks: true },
  scheduledTasks: {
    '0 8 * * *': ['email:send-scheduled'],  // daily at 8am
    '0 * * * *': ['backup:sqlite'],          // hourly, VPS only
  },
}
```

### SQLite Backup Task

```ts
// server/tasks/backup/sqlite.ts
import { readFile } from 'node:fs/promises'

export default defineTask({
  meta: {
    name: 'backup:sqlite',
    description: 'Backup SQLite database to blob storage',
  },
  async run() {
    const dbPath = '.data/db/sqlite.db'
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
    const key = `backups/${timestamp}.sqlite3`

    const file = await readFile(dbPath)
    await blob.put(key, file, {
      contentType: 'application/x-sqlite3',
    })

    return { result: `Backed up to ${key}` }
  },
})
```

### Email Scheduling Task

```ts
// server/tasks/email/send-scheduled.ts
export default defineTask({
  meta: {
    name: 'email:send-scheduled',
    description: 'Send scheduled booking reminder and follow-up emails',
  },
  async run() {
    const db = useDB()
    // Query bookings needing reminders/follow-ups
    // Match against email templates with matching triggers
    // Send via useEmailService() and log
    return { result: `Sent ${count} scheduled emails` }
  },
})
```

---

## CI/CD via GitHub Actions

VPS deploy workflow template:
```yaml
name: Deploy
on:
  push:
    branches: [main]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: pnpm install
      - run: pnpm test
      - run: pnpm lint

  deploy:
    needs: test
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: pnpm install && pnpm build
      - name: Deploy to server
        uses: appleboy/ssh-action@v1
        with:
          host: ${{ secrets.SERVER_HOST }}
          username: ${{ secrets.SERVER_USER }}
          key: ${{ secrets.SSH_KEY }}
          script: |
            cd /opt/apps/my-app
            git pull
            pnpm install
            pnpm build
            sudo systemctl restart my-app
```

Cloudflare deploy workflows (existing) use `wrangler pages deploy` -- no changes needed.

---

## CLI Commands

Deploy commands in `packages/crouton-cli/` (`@fyit/crouton-cli`), built with **citty** + **@clack/prompts**.

**Remote execution**: SSH/rsync via `execa`. Leverages existing `~/.ssh/config` and keys.

**Config storage**: `.crouton/deploy.json` (gitignored), multi-environment:

```json
{
  "defaultEnvironment": "production",
  "environments": {
    "production": {
      "host": "116.203.x.x",
      "user": "deploy",
      "path": "/opt/apps/myapp"
    },
    "staging": {
      "host": "116.203.x.x",
      "user": "deploy",
      "path": "/opt/apps/myapp-staging"
    }
  }
}
```

### Server setup
```bash
npx crouton deploy init                # SSH into VPS, install Caddy + Node + Redis
npx crouton deploy setup <app-name>    # Create app dir, Caddyfile entry, .env, systemd
```

### Day-to-day
```bash
npx crouton deploy push                # Build + rsync + restart
npx crouton deploy push --env staging  # Deploy to staging
npx crouton deploy logs                # Tail remote logs
npx crouton deploy env set KEY=VALUE   # Set env var on server
npx crouton deploy env list            # Show current env vars
```

### Database
```bash
npx crouton db backup                  # Trigger Nitro backup task
npx crouton db restore <timestamp>     # Restore from blob storage
npx crouton db download                # Pull remote SQLite for debugging
```

### Email
```bash
npx crouton email test                 # Send test email
npx crouton email verify-dns           # Check SPF/DKIM/DMARC
```

---

## Monorepo Context

| Question | Answer |
|---|---|
| Package scope | `@fyit/*` |
| Shared package | `packages/crouton-core/` |
| CLI package | `packages/crouton-cli/` |
| Config storage | `.crouton/deploy.json` (gitignored) |
| Existing Docker | None |
| Existing deploy | Cloudflare Pages via GitHub CI + wrangler |
| Existing CI | `.github/workflows/ci.yml` |
| `@nuxthub/core` | Loaded via crouton-core layer |

---

## Server Hardening Checklist (include in docs)

- [ ] SSH key-only auth (disable password login)
- [ ] Cloud Firewall (allow 80, 443, 22 only)
- [ ] Unattended upgrades for OS security patches
- [ ] Log rotation (prevent disk fill)
- [ ] Monitoring: provider alerts or self-host Uptime Kuma
- [ ] Backup verification: monthly test restore

---

## Priority Summary

| Phase | Effort | Impact | When |
|---|---|---|---|
| Phase 0 -- Remove CF references | ~1 hour | Unblocks everything | Now |
| Phase 1 -- Preset-agnostic build | ~1 day | Apps run on any VPS | Next |
| Phase 2 -- VPS deploy tooling | ~3-5 days | One-command VPS deploy | After Phase 1 |
| Phase 3 -- Collab abstraction | ~2 weeks | Collab works everywhere | When needed |
| Phase 4 -- Documentation | ~2 days | Provider recipes | After Phase 2 |
| Phase 5 -- Validation | ~2 days | Confidence it works | After Phase 4 |
