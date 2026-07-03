# CLAUDE.md - @fyit/crouton-triage

## Package Purpose

Discussion-to-task triage system for Nuxt applications. Receives discussions from multiple sources (Slack, Figma, email), analyzes them with AI (Claude), detects actionable tasks, and creates Notion pages. Works as a Nuxt layer that integrates with `@fyit/crouton-core` and `@fyit/crouton-ai`.

## Key Files

| File | Purpose |
|------|---------|
| `nuxt.config.ts` | Layer configuration, component registration, i18n setup |
| `crouton.manifest.ts` | Defines 9 collections with `triage` table prefix |
| `app/types/index.ts` | Core types: Flow, FlowInput, FlowOutput, ParsedDiscussion, AdapterConfig, etc. |
| `app/composables/useTriageConnectedAccounts.ts` | Connected accounts CRUD (team-scoped) |
| `app/composables/useTriageOAuth.ts` | OAuth flow for Slack integration |
| `app/composables/useTriageAutoMatch.ts` | Auto-match users across platforms |
| `app/composables/useTriageNotionSchema.ts` | Fetch Notion database schema |
| `app/composables/useTriageNotionUsers.ts` | Fetch Notion workspace users |
| `app/composables/useTriageSlackUsers.ts` | Fetch Slack workspace users |
| `shared/utils/field-mapping.ts` | Shared similarity + field-mapping utils (used by app + server) |
| `app/composables/useTriageFieldMapping.ts` | Notion field mapping composable (wraps shared utils) |
| `app/composables/useTriagePromptPreview.ts` | AI prompt preview and testing |
| `app/components/flows/FlowList.vue` | Flow list with create/edit actions |
| `app/components/flows/InputManager.vue` | Manage flow inputs (sources) |
| `app/components/flows/OutputManager.vue` | Manage flow outputs (Notion targets) |
| `app/components/usermappings/` | User mapping discovery and management |
| `server/utils/tokenResolver.ts` | Centralized token resolution from connected accounts |
| `server/adapters/` | Source adapters: Slack, Figma, Notion |
| `server/services/processor.ts` | Main processing pipeline (~2100 lines) |
| `server/services/ai.ts` | Claude AI analysis (summarization, task detection) |
| `server/services/notion.ts` | Notion API integration |
| `server/services/reply-generator.ts` | AI reply generation with personality |
| `server/services/userMapping.ts` | Cross-platform user mapping |
| `server/utils/domain-routing.ts` | AI-powered domain routing for multi-output flows |
| `server/api/crouton-triage/` | API endpoints |
| `schemas/` | 8 JSON schema definitions |
| `seed/index.ts` | Seed provider (`@fyit/crouton-triage/seed`, #697) — seeds the user-facing content chain (flow → input → discussions → tasks + inbox messages) so the Triage admin surfaces open populated. Integration-plumbing collections (accounts/outputs/jobs/users) are intentionally NOT seeded |

## Architecture

### Processing Pipeline

```
Source (Slack/Figma/Email)
  → Webhook received
  → Adapter parses incoming data
  → Find matching Flow + FlowInput
  → Build discussion thread
  → AI Analysis (Claude)
    ├── Summarize discussion
    ├── Detect actionable tasks
    └── Route to domains
  → Create Notion pages (per FlowOutput)
  → Post reply to source thread
  → Store in database
```

### Components (Prefixed: CroutonTriage)

```
CroutonTriage
├── flows/
│   ├── FlowList.vue          - Flow listing and management
│   ├── FlowPipelineVisual.vue - Visual pipeline diagram
│   ├── InputManager.vue      - Source input configuration
│   └── OutputManager.vue     - Notion output configuration
├── usermappings/
│   ├── UserMappingTable.vue  - Mapping list/table
│   ├── UserMappingDrawer.vue - Edit mapping drawer
│   ├── SlackUserDiscovery.vue - Discover Slack users
│   ├── FigmaUserDiscovery.vue - Discover Figma users
│   ├── NotionUserDiscovery.vue - Discover Notion users
│   └── NotionUserPicker.vue  - Notion user selection
├── shared/
│   └── PromptPreviewModal.vue - AI prompt preview
├── EmptyState.vue
└── LoadingSkeleton.vue
```

### API Endpoints

**Webhooks (no auth):**

| Path | Method | Purpose |
|------|--------|---------|
| `/api/crouton-triage/webhooks/slack` | POST | Slack event webhooks |
| `/api/crouton-triage/webhooks/slack-test` | POST | Slack webhook testing |
| `/api/crouton-triage/webhooks/figma-email` | POST | Figma email via Mailgun |
| `/api/crouton-triage/webhooks/resend` | POST | Figma email via Resend |
| `/api/crouton-triage/webhooks/notion` | POST | Notion task completion |
| `/api/crouton-triage/webhooks/notion-input` | POST | Notion as input source |

**Team-scoped (auth required):**

| Path | Method | Purpose |
|------|--------|---------|
| `/api/crouton-triage/teams/[id]/discussions/process` | POST | Manual discussion processing |
| `/api/crouton-triage/teams/[id]/discussions/[discussionId]/retry` | POST | Retry failed discussion |
| `/api/crouton-triage/teams/[id]/notion/users` | GET | List Notion users |
| `/api/crouton-triage/teams/[id]/notion/schema/[databaseId]` | GET | Get Notion DB schema |
| `/api/crouton-triage/teams/[id]/notion/test-connection` | POST | Test Notion connection |
| `/api/crouton-triage/teams/[id]/slack/users` | GET | List Slack users |
| `/api/crouton-triage/teams/[id]/user-mappings/bulk-import` | POST | Bulk import user mappings |
| `/api/crouton-triage/teams/[id]/ai/suggest-icons` | POST | AI icon suggestions |
| `/api/crouton-triage/teams/[id]/accounts/connect` | POST | Manually connect account (paste token) |
| `/api/crouton-triage/teams/[id]/accounts/[accountId]/verify` | POST | Verify connected account token |

**OAuth:**

| Path | Method | Purpose |
|------|--------|---------|
| `/api/crouton-triage/oauth/slack/install` | GET | Start Slack OAuth |
| `/api/crouton-triage/oauth/slack/callback` | GET | Slack OAuth callback |

**Utility:**

| Path | Method | Purpose |
|------|--------|---------|
| `/api/crouton-triage/health` | GET | Health check |
| `/api/crouton-triage/metrics` | GET | Processing metrics |

### Key Concepts

- **Flow**: A processing pipeline configuration (AI settings, domains, prompts)
- **FlowInput**: A source connection (Slack channel, Figma file, email address)
- **FlowOutput**: A Notion database target with field mapping and domain filter
- **AdapterConfig**: Slim type with only what adapters need (id, teamId, sourceType, apiToken, sourceMetadata, webhookUrl)
- **Domain Routing**: AI detects task domains and routes to matching FlowOutputs

## Configuration

### App Requirements

Apps using this package must enable KV storage for Slack OAuth state:

```typescript
hub: { db: 'sqlite', kv: true }
```

### Nuxt Config

```typescript
// nuxt.config.ts
export default defineNuxtConfig({
  extends: [
    '@fyit/crouton-core',
    '@fyit/crouton-triage',
    './layers/triage'  // Generated collections (MUST be last)
  ],

  hub: { db: 'sqlite', kv: true },

  runtimeConfig: {
    croutonTriage: {
      anthropicApiKey: '',  // or NUXT_CROUTON_TRIAGE_ANTHROPIC_API_KEY
      slack: {
        clientId: '',
        clientSecret: '',
        signingSecret: ''
      },
      resend: {
        apiToken: '',
        webhookSigningSecret: ''
      }
    }
  }
})
```

## Common Tasks

### Add a New Adapter

1. Create `server/adapters/mySource.ts` extending `BaseAdapter`
2. Implement `parseIncoming()`, `fetchThread()`, `postReply()`
3. Register in `server/adapters/index.ts`

### Add a New Composable

1. Create `app/composables/useTriageFeature.ts`
2. Export composable function
3. Auto-imports via Nuxt layer

### Add a New Component

1. Create in `app/components/[Category]/MyComponent.vue`
2. Auto-registers as `CroutonTriage[Category]MyComponent`
3. Use Composition API with `<script setup lang="ts">`

### Add a New API Endpoint

1. Create in `server/api/crouton-triage/teams/[id]/endpoint.get.ts`
2. Use `defineEventHandler`
3. Use `resolveTeamAndCheckMembership(event)` for auth

## Dependencies

- **Required**: `@fyit/crouton-core`, `@fyit/crouton-ai`
- **Runtime**: `cheerio`
- **Peer**: `nuxt`, `zod`

## Table Naming Convention

Package expects tables prefixed with `triage`:

| Schema | Table Name |
|--------|------------|
| discussion.json | `triageDiscussions` |
| flow.json | `triageFlows` |
| input.json | `triageInputs` |
| output.json | `triageOutputs` |
| task.json | `triageTasks` |
| job.json | `triageJobs` |
| user.json | `triageUsers` |
| message.json | `triageMessages` |
| account.json | `triageAccounts` |

## i18n Keys

Translations in `i18n/locales/{en,nl,fr}.json`:

```
triage.
└── admin.*  - Admin sidebar labels
```

## Extending the Triage Sidebar

Consuming apps can add routes to the Triage sidebar section using the `parentApp` pattern. Register your layer's app config with `parentApp: 'triage'` and your routes will appear alongside the built-in Triage routes (Overview, Discussions, Tasks, Jobs, Inbox).

```typescript
// layers/my-triage-feature/app/app.config.ts
export default defineAppConfig({
  croutonApps: {
    myTriageFeature: {
      id: 'myTriageFeature',
      parentApp: 'triage',
      name: 'My Feature',
      icon: 'i-lucide-star',
      adminRoutes: [
        { path: '/my-feature', label: 'My Feature', icon: 'i-lucide-star' }
      ],
      dashboardRoutes: [],
      settingsRoutes: [],
    }
  }
})
```

See `packages/crouton-core/CLAUDE.md` for the full `parentApp` pattern documentation.

## Demo Seeding (`@fyit/crouton-triage/seed`)

Part of the composable seeding system (epic #82, contract in
`@fyit/crouton-core/shared/seed`). Provider id `triage`, `dependsOn: ['auth']`.

Triage is integration-driven (Slack/Figma/email → AI → Notion), so most of its
collections are **plumbing tied to live credentials** — `accounts` (OAuth),
`outputs` (Notion targets), `jobs` (sync runs), `users` (platform identities).
Seeding those with fake rows would misrepresent a working integration, so the
provider seeds only the **user-facing content chain** a reviewer opens:

```
flow → input → discussions → tasks   (+ a couple of inbox messages)
```

- 1 flow ("Support Triage") + 1 Slack input (demo display config, no live token)
- 3 discussions (varied status: completed/pending) with AI summaries + key points
- 2 tasks (one per resolved discussion; `notionPageId`/`notionPageUrl` are demo
  placeholders — `notionPageId` is unique per team, so stable demo ids stay idempotent)
- 2 inbox messages

Pure module (references `triage_*` table/columns by name, loads under jiti).
Idempotent — stable `seedId(...)` ids upsert in place; every NOT-NULL column is
set explicitly. Run via an app's `crouton-seed` / `db:seed:*` scripts.

> **Discovery note:** `crouton-seed` finds providers by walking the app's
> `package.json` dependency graph (not its `nuxt.config` extends). `apps/triage`
> now declares `@fyit/crouton-triage` as a dependency (#698) so this provider is
> discovered and seeded there.

## Naming Conventions

```
Component: CroutonTriage[Category][Name]
Composable: useTriage[Feature]
API: /api/crouton-triage/teams/[id]/[resource]
Type: [Entity] (e.g., Flow, FlowInput, ParsedDiscussion)
Table: triage[Collection] (e.g., triageDiscussions)
```
