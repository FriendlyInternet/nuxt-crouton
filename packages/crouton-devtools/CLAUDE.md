# CLAUDE.md - @fyit/crouton-devtools

## Package Purpose

DevTools integration for Nuxt Crouton. Provides visual inspection and management of CRUD collections in Nuxt DevTools with zero config.

## Key Files

> **The in-page feedback toolkit moved to `@fyit/crouton-feedback` (epic #960).**
> The glasses launcher, the Console (eruda) + Annotate tools, the tool registry,
> the source-stamp transform, and the sink dispatcher are no longer here — this
> package **installs** `@fyit/crouton-feedback` under its own gate (`installModule`
> in `module.ts`), so `crouton init` apps need no extra wiring and the staging
> review flow is unchanged. crouton-devtools keeps only the **DevTools-tab**
> surface (collections / operations / events / data-browser) + the operation
> tracker. Back-compat: `server/plugins/reviewAlias.ts` maps the legacy
> `NUXT_CROUTON_REVIEW_*` secrets onto crouton-feedback's `github` sink at runtime,
> so existing staging deploys keep working without a secret rename (#966).

| File | Purpose |
|------|---------|
| `src/module.ts` | Nuxt module entry — installs `@fyit/crouton-feedback` (the overlay toolkit) + registers the DevTools tabs |
| `src/runtime/server/plugins/reviewAlias.ts` | Nitro plugin: aliases legacy `NUXT_CROUTON_REVIEW_*` config → `croutonFeedback` github sink (back-compat, #966) |
| `src/runtime/pages/data-browser.vue` | Collection inspector UI |
| `src/runtime/server-rpc/client.ts` | Embedded DevTools UI (Vue app) |
| `src/runtime/server-rpc/collections.ts` | Get collections RPC |
| `src/runtime/server-rpc/operations.ts` | Get operations RPC |
| `src/runtime/server-rpc/events.ts` | Query persisted events (when events package installed) |
| `src/runtime/server-rpc/eventsHealth.ts` | Events health statistics |
| `src/runtime/server/utils/operationStore.ts` | In-memory operation tracking |
| `src/runtime/server/plugins/operationTracker.ts` | Nitro plugin for tracking API calls |

## Features

- **Collections Tab** - View all registered collections with search & filter
- **Operations Tab** - Monitor live CRUD operations in real-time
- **API Explorer Tab** - Test collection endpoints interactively
- **Data Browser Tab** - Browse collection data with layout options
- **Activity Tab** - Unified events view (when `nuxt-crouton-events` installed)
- Dark mode support
- Auto-refresh capabilities

## Installation

```typescript
// nuxt.config.ts
export default defineNuxtConfig({
  modules: [
    '@nuxt/devtools',
    '@fyit/crouton-devtools'
  ],
  devtools: {
    enabled: true
  }
})
```

**Auto-included in `crouton init` scaffolds (#595):** `@fyit/crouton-devtools` is automatically added to the generated app's `devDependencies` and `modules` array. The generated `cf:staging` script prefixes `NUXT_PUBLIC_CROUTON_REVIEW=true` so staging builds activate the review overlay without any extra configuration. Production builds (`cf:deploy`) omit the flag, so there is zero production footprint.

## Mobile DevTools (eruda) layer — `@fyit/crouton-devtools/eruda`

A separate, **opt-in Nuxt layer** (not the DevTools module above) that adds
[eruda](https://github.com/liriliri/eruda) — an **in-page** devtools panel for
**mobile** browsers (console incl. Vue hydration warnings, Elements/DOM, Network).
Use it to debug a preview on a phone where desktop DevTools aren't available.

```typescript
// nuxt.config.ts — opt in (apps/pocs choose this; it is NOT auto-applied)
export default defineNuxtConfig({
  extends: ['@fyit/crouton-devtools/eruda']
})
```

**Gating — staging/dev only, NEVER production:** the layer's client plugin loads
eruda only when `import.meta.dev` (local) **or** the public flag
`croutonEruda` is true. Enable it for a staging build by setting the env var in the
app's `cf:staging` script; leave `cf:deploy` (production) untouched:

```jsonc
// app package.json
"cf:staging": "NUXT_PUBLIC_CROUTON_ERUDA=true NITRO_PRESET=cloudflare_module nuxt build && …",
"cf:deploy":  "NITRO_PRESET=cloudflare_module nuxt build && …"   // no flag → eruda never loads
```

- eruda is a **dynamic import** → its own chunk, **never fetched** when the flag is
  false, so production pays ~nothing.
- `NUXT_PUBLIC_CROUTON_ERUDA` maps to `runtimeConfig.public.croutonEruda` (Nuxt env
  convention).
- Files: `eruda/nuxt.config.ts` (layer entry + flag), `eruda/plugins/eruda.client.ts`
  (gated loader). For *arbitrary* sites on the go, a dedicated inspector app (e.g.
  Inspect Browser) stays the companion. Epic #387.

## What You'll See

### Collection Inspector

- **Collection Cards** - Quick overview of each collection
- **Search & Filter** - Find by name, layer, or API path
- **Layer Badges** - Internal/external/custom indicators
- **Detail View** - Click for full configuration

### Collection Details

- Name and key
- API path
- Component name
- Layer type
- Full JSON configuration

### Activity Tab (Events Integration)

When `nuxt-crouton-events` is installed, the Activity tab appears automatically:

- **Health Dashboard** - Total events, today's count, this week, status
- **Operation Breakdown** - CREATE/UPDATE/DELETE counts
- **Filters** - By collection, operation type, limit
- **Events List** - Timeline of persisted mutation events
- **Event ↔ Operation Correlation** - Link HTTP operations to events via itemId

The module auto-detects the events package via layer inspection.

## In-page feedback toolkit -> moved to `@fyit/crouton-feedback` (#960)

The **glasses launcher + tool registry**, the **Console (eruda)** and **Annotate**
tools, the **`data-feedback-src` source-stamp transform**, and the **feedback sink**
(`POST /api/_feedback` -> webhook / slack / discord / github) were extracted into
**`@fyit/crouton-feedback`** so any Nuxt UI app can use them. This package
`installModule`s it (see `src/module.ts`) under the devtools gate, so `crouton init`
apps get the launcher with no extra wiring.

- **Where it is now:** `packages/crouton-feedback/` (see its `CLAUDE.md`).
- **Changelog tool (#1048):** the `croutonDevtools.changelog` option is forwarded
  into the `installModule` call, so crouton apps configure the version-timeline tool
  here (a standalone crouton-feedback app would use `croutonFeedback.changelog`).
  Point it at a committed `changelog.json`; see crouton-feedback's `CLAUDE.md`.
- **Staging review back-compat (#966):** `src/runtime/server/plugins/reviewAlias.ts`
  maps the legacy `NUXT_CROUTON_REVIEW_*` secrets onto the crouton-feedback github
  sink at runtime, so existing deploys keep posting the Preview-feedback PR comment.
- The separate **eruda layer** (`@fyit/crouton-devtools/eruda`, above) is unrelated
  and still shipped here.

## Architecture

```
src/
├── module.ts                    # Nuxt module (events detection, tab registration)
├── runtime/
│   ├── pages/
│   │   └── data-browser.vue    # Data browser page
│   ├── server-rpc/
│   │   ├── client.ts           # Embedded Vue app (all tabs)
│   │   ├── collections.ts      # Get collections
│   │   ├── endpoints.ts        # List endpoints
│   │   ├── operations.ts       # Track operations
│   │   ├── events.ts           # Query persisted events
│   │   └── eventsHealth.ts     # Events health stats
│   └── server/
│       ├── plugins/
│       │   └── operationTracker.ts  # Nitro plugin
│       └── utils/
│           └── operationStore.ts    # In-memory store
```

## Common Tasks

### Add new DevTools tab
1. Create page in `src/runtime/pages/`
2. Register in `module.ts` with `addCustomTab()`
3. Add server RPC if needed

### Add operation tracking
Use `src/runtime/server/utils/operationStore.ts` utilities.

## Development

```bash
# Build module
pnpm build

# Test in playground
cd playground && pnpm dev
```

## Roadmap

- ✅ Phase 1: Collection inspector
- ✅ Phase 2: CRUD operations monitoring, API testing
- ✅ Phase 3: Collection data browser
- ✅ Phase 4: Events integration (Activity tab)
- Phase 5: Generator history and rollback
- Phase 6: Schema validation, i18n manager

## Dependencies

- **Core**: `@nuxt/devtools-kit ^1.6.4`, `@nuxt/kit ^3.15.1`
- **Build**: `unbuild ^3.6.1`
- **Dev only**: Zero production impact

## Testing

```bash
pnpm typecheck && pnpm typecheck:packages  # from the repo root; see root CLAUDE.md "Post-change checks"
pnpm build          # Build module
```
