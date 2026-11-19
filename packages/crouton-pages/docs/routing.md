# Crouton Pages — Routing Architecture

How public page URLs are resolved, from request to render.

## Route Table

Nuxt auto-generates these routes from the file system:

| Route Name | Pattern | Source | Purpose |
|---|---|---|---|
| `team-locale-slug` | `/:team/:locale/:slug(.*)*` | `[team]/[locale]/[...slug].vue` | Main page renderer (renders `CroutonPagesPublicPage`); forwards to the plain address when `hideLocaleInUrl` is on |
| `team-slug` | `/:team/:slug(.*)*` | `[team]/[...slug].vue` | Locale-less redirect for the bare team address (`/acme`); renders the page at `/acme/<slug>` when `hideLocaleInUrl` is on |

> With `hideLocaleInUrl: true` (team mode, exactly one locale) the `team-locale-slug` pattern becomes `/:team/:locale(<code>)/:slug(.*)*` at build time, so `/acme/about` falls through to `team-slug`, and `/acme/<code>/about` forwards (302) to the plain address. The build fails when the app has more than one locale.

> In **locale mode** (`routingMode: 'locale'`), both routes are removed by the `pages:extend` hook. The app provides its own page routes (e.g., `[locale]/[...slug].vue`).

## Two Modes

### 1. Team Mode (default)

URLs include the team slug: `/acme/en/about`

No special config needed. The `team-locale-slug` route handles everything.

```
/acme           → [team]/[...slug].vue → redirect to /acme/en
/acme/en/about  → [team]/[locale]/[...slug].vue → render page
/acme/about     → [team]/[locale]/[...slug].vue (locale="about") → 404
```

With `hideLocaleInUrl: true` (one-locale apps):

```
/acme/about     → [team]/[...slug].vue → render page
/acme/en/about  → [team]/[locale]/[...slug].vue → 302 to /acme/about
```

### 2. Locale Mode

URLs omit the team slug: `/nl/about`. The app provides its own page routes.

```typescript
// nuxt.config.ts
runtimeConfig: {
  public: {
    croutonPages: {
      routingMode: 'locale',
      defaultLocale: 'nl'
    }
  }
}
```

In locale mode, crouton-pages:
- **Keeps**: admin routes (`/admin/[team]/*`), server APIs (`/api/teams/[id]/pages/*`), `useNavigation()`, `useDomainContext()`
- **Skips**: public page route registration, virtual single-team route

```
/           → Nitro plugin redirects to /nl/ (302)
/nl/        → App's own [locale]/[...slug].vue → render homepage
/nl/about   → App's own [locale]/[...slug].vue → render page
```

### Custom Domain Mode

A verified custom domain resolves to a team. URLs omit the team slug.

```
booking.acme.com/about → domain-resolver rewrites to /acme/about
                       → [team]/[locale]/[...slug].vue sees an unknown locale and,
                         on a connected domain only, forwards 302 to /en/about
                       → rewritten to /acme/en/about (the team never shows in the address)
                       → render page (nav links keep the team — `hideTeamInLinks` is false —
                         and the team-host history hides it from the address bar and every href)
(with hideLocaleInUrl on, booking.acme.com/about → /acme/about → [team]/[...slug].vue
 → render page directly; no locale forward)
```

## Request Lifecycle (Team Mode)

```
Browser: GET /acme/en/about
         │
         ▼
┌─────────────────────────────────┐
│  Nitro Plugins (server only)    │
│                                 │
│  1. domain-resolver.ts          │
│     Custom domain? Rewrite URL  │
│     booking.acme.com/about      │
│     → /acme/about               │
│                                 │
│  2. single-team-rewrite.ts      │
│     (no-op in team mode)        │
│                                 │
└─────────────────┬───────────────┘
                  │
                  ▼
┌─────────────────────────────────┐
│  Vue Router (SSR + client)      │
│                                 │
│  Matches team-locale-slug       │
│  Params: team=acme, locale=en,  │
│          slug=['about']         │
│                                 │
└─────────────────┬───────────────┘
                  │
                  ▼
┌─────────────────────────────────┐
│  Page Validate                  │
│                                 │
│  - Reserved prefix? → false     │
│  - API check team exists        │
│                                 │
└─────────────────┬───────────────┘
                  │
                  ▼
┌─────────────────────────────────┐
│  Page Setup (param resolution)  │
│                                 │
│  team = route.params.team       │
│  locale = route.params.locale   │
│  slug = route.params.slug       │
│                                 │
└─────────────────┬───────────────┘
                  │
                  ▼
┌─────────────────────────────────┐
│  Fetch + Render                 │
│                                 │
│  GET /api/teams/{team}/pages/   │
│      {slug}?locale={locale}     │
│                                 │
│  → CroutonPagesRenderer        │
└─────────────────────────────────┘
```

## Request Lifecycle (Locale Mode)

```
Browser: GET /nl/about
         │
         ▼
┌─────────────────────────────────┐
│  Nitro Plugin                   │
│  single-team-rewrite.ts         │
│                                 │
│  Set context.routingMode =      │
│    'locale'                     │
│  Root / → redirect /nl/         │
│                                 │
└─────────────────┬───────────────┘
                  │
                  ▼
┌─────────────────────────────────┐
│  App's own page routes          │
│  (provided by the app, not      │
│   crouton-pages)                │
│                                 │
│  e.g., [locale]/[...slug].vue   │
│  Uses useNavigation() for nav   │
│  Uses useDomainContext() for    │
│  hideTeamInUrl                  │
│                                 │
└─────────────────────────────────┘
```

## Navigation Links

`useNavigation()` builds paths based on `useDomainContext().hideTeamInLinks`:

```
hideTeamInLinks = true  → /nl/about
hideTeamInLinks = false → /acme/nl/about
```

`hideTeamInLinks` is `true` only when locale/custom routing mode is active. On a custom domain (team mode) links keep the team and `app/router.options.ts` strips it from the address bar and every `href`. `hideTeamInUrl` (locale mode OR custom domain) still drives canonical URLs and team UI.

## Nitro Plugins

### `single-team-rewrite.ts`

Sets context flags for downstream code. Active only in locale mode.

| Action | Details |
|---|---|
| Skip | API, auth, admin, `_nuxt`, static files |
| Set context | `event.context.routingMode = 'locale'` |
| Root redirect | `/` → `/{defaultLocale}/` (302) |
| Team mode | No-op (plugin returns early) |

### `domain-resolver.ts`

Rewrites custom domain requests by prepending the team slug.

| Action | Details |
|---|---|
| Skip | Localhost, IP, app domains, static files, /api, /auth, /admin, /dashboard, /_* (no domain lookup) — and no rewrite for the app's own top-level pages (read from the page tree at build time: e.g. /account, /onboarding, /super-admin, plus any page the app adds at the top level) or paths already starting with this team's own slug (team mode; locale/custom mode keeps the old slug-shape rule) |
| Lookup | Query `domain` table for verified domain |
| Check | `publicSiteEnabled` in team settings |
| Rewrite | `/about` → `/acme/about`, `/en/about` → `/acme/en/about`, `/` → `/acme` |
| Set flags | `resolvedDomain`, `resolvedDomainTeamId`, `isCustomDomain`, `resolvedDomainTeamSlug`, `resolvedDomainAppSegments` |

> The server sees the rewritten URL; the browser keeps the plain address. On a connected domain (team mode) the package builds links with the team (`hideTeamInLinks` is false) so the router and the page `validate` match the team route, and `app/router.options.ts` installs `teamHostHistory`, which adds the team when reading the address bar and strips it when writing or building an `href`. A hand-typed internal link without the team (e.g. a button's raw URL `/fr/contact`) does not work on click there — use a page link.

## Validate Behavior

**`definePageMeta.validate` returning `false` = 404.** Nuxt does NOT fall through to the next matching route.

## Key Files

| File | Purpose |
|---|---|
| `app/pages/[team]/[locale]/[...slug].vue` | Main page renderer (team mode only) |
| `app/pages/[team]/[...slug].vue` | Locale-less redirect route (team mode only); renders pages when `hideLocaleInUrl` is on |
| `app/components/PublicPage.vue` | `CroutonPagesPublicPage` — the one public page renderer both routes use (prop `locale`) |
| `app/utils/public-routes.ts` | `applyPublicRouteOptions` / `assertSingleLocale` — the `pages:extend` route logic (remove in locale/custom mode, pin the locale for `hideLocaleInUrl`) |
| `server/plugins/single-team-rewrite.ts` | Context flags + root redirect (locale mode) |
| `server/plugins/domain-resolver.ts` | Custom domain URL rewriting |
| `app/composables/useDomainContext.ts` | `hideTeamInUrl`, `hideTeamInLinks`, `hideLocaleInUrl`, `isTeamHost`, `isLocaleMode`, `isCustomDomain`, `resolvedTeamSlug`, `appSegments` |
| `app/composables/useNavigation.ts` | Navigation link building (respects hideTeamInLinks + hideLocaleInUrl) |
| `app/router.options.ts` | Installs the team-host history on a connected domain (team mode) |
| `app/utils/team-host-history.ts` / `app/utils/custom-domain-path.ts` | Address-bar and rewrite rules |
| `nuxt.config.ts` | `pages:extend` hook, `routingMode` + `hideLocaleInUrl` config |

## Gotchas

1. **Route scoring matters** — a plain param (`/:team`) scores lower than a regex param (`/:locale([a-z]{2,3})`)
2. **Validate rejection = 404** — Nuxt does not try the next route
3. **`useI18n().locale` can be empty during hydration** — always use a fallback
4. **`useDomainContext()` must be called at top level** — it reads SSR event context that's only available during the initial request
