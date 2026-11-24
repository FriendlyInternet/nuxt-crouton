# kdm — HANDOFF

Kasper Demeulemeester's site (kasperdemeulemeester.be), moving from Nuxt Content + Decap/Netlify
onto crouton so pages can be edited in the browser. Epic: https://github.com/FriendlyInternet/nuxt-crouton/issues/4125

Status: Kasper's plain look on crouton's normal team pages (#4153, rewritten 19 Nov). Pages made in
the editor show at `/kdm/en/<slug>` (e.g. `/kdm/en/welcome`); the site's one team is `kdm` (#4488).
`/` is crouton's start page with the sign-in pop-up. No imported content yet. Staging preview: https://kdm.pmcp.dev.

## Decisions (from epic #4125)

- [2026-11-18] App lives at `pocs/kdm`, not `apps/` → repo rule: new apps start in `pocs/`, move to `apps/` at production launch.
- [2026-11-18] The markdown content is committed as seed input → the source repo `pmcp/kdm` and the live site are already public, so nothing new is published.
- [2026-11-18] Drop `test.md`; merge the two identical-titled album pages into one with a redirect → one is a leftover test, the other a duplicate slug of the same page.
- [2026-11-18] Old page addresses are kept exactly → existing links to the site keep working when the domain moves later.
- [2026-11-18] Public routing: `croutonPages.routingMode: 'custom'` + app-level `app/pages/index.vue` and `app/pages/[slug].vue` (in the app, not a `layers/site` layer — one site, nothing to share) → plain addresses with no team or locale. Both pages read through the package's own `GET /api/teams/test1/pages/<slug>?locale=en` (publish + visibility checks live there) via `app/composables/useSitePage.ts`; rejected: alexdeforce's `/api/public/pages/[slug]` (no team/visibility check).
- [2026-11-19] **Reversed the line above.** Hand-written addresses broke signing in (`/auth/login` no longer reached the start page's sign-in pop-up) and editor links. Public routing is now crouton-pages' default `team` mode: `/[team]/[locale]/[...slug]`; the app adds only a look (`app/layouts/public.vue`, `main.css`) and settings (`crouton.config.js` locales). Plain addresses come later from connecting Kasper's domain (and #4154 for dropping `/en/`). Rule: `pocs/kdm` has no public page routes, no redirect middleware, nothing that changes sign-in or page links.
- [2026-11-19] One language: `locales: ['en']`, `defaultLocale: 'en'` in `crouton.config.js` → content is mixed English/Dutch and not translated; without it the app got en/nl/fr.
- [2026-11-18] On staging the site's one team is the demo team `test1`, not a team called `kdm` → every preview attaches the review login to `test1` only, so content and login must share that team; the name never shows in a public address.
- [2026-11-24] Team renamed test1 → kdm (#4488, via reviewTeam #4141); supersedes the 18 Nov test1 line → `deploy.config.json` `"reviewTeam": "kdm"` makes every preview seed and sign in to `kdm`; `croutonAuth.teams.defaultTeamSlug` is `kdm` to match. Pages are at `/kdm/en/<slug>`; `/test1/en/welcome` is a 404.
- [2026-11-24] .gitignore aligned with main so the epic branch takes main again (#4488); Claude's page tools follow in the split-off ticket → the epic's `pocs/kdm/.data` line conflicted with main's new lines at the end of the file, so the main sync gave up and workers ran on an old base without crouton-auth's `mcpOAuth`.

## What the scaffold learned (#4126)

- Scaffolded with `crouton init kdm --poc --features pages,assets,editor,i18n -d sqlite`, **without**
  `--domain`: with `--domain` the CLI writes a top-level (production) route plus `kdm-staging.pmcp.dev`,
  which is the wrong shape. The staging-only route `kdm.pmcp.dev` lives under `env.staging.routes`.
- `cf:version` (used by the previews workflow) is not written by the CLI — added by hand, same line as `pocs/snippets`.
- Blob storage: the CLI writes no `r2_buckets` and `hub.blob` was off — both added by hand
  (`kdm-blob`, `kdm-staging-blob`, pattern from `pocs/crate`). Whether the deploy creates a missing
  bucket by itself is unverified; if the preview fails on the bucket, that's an owner action (report on the epic).
- `@fyit/crouton-devtools` moved to `dependencies`; `vitest` set to `catalog:`.
- Single-team auth: `croutonAuth.teams = { defaultTeamSlug: 'kdm', allowCreate: false, showSwitcher: false, showManagement: false }`
  (was `test1` until #4488). It must equal `reviewTeam` in `deploy.config.json` — `scripts/review-team.mjs` fails the deploy otherwise.
- Colour mode pinned to light (`kdm-color-mode`).

## What the look learned (#4153)

- **How the look is applied:** `app/layouts/public.vue` overrides crouton-pages' `public` layout (an
  app layout of the same name wins over a layer's; the package page route sets `layout: 'public'`).
  Kept from the package layout: the `pageLayout` and `pageChrome` state, the post-hydration class
  fix-up, the nav pill **for signed-in users** (it carries the "edit this page" pencil the page route
  registers with `registerNavAction`) and the editing drawer, unchanged. Dropped for signed-out
  visitors only (`useSession().isAuthenticated`): the nav pill (menu, logo, sign-in control) and the
  footer. No package setting could do that per visitor, hence the override.
- Column = source `default.vue` + `[...slug].vue`: `max-w-4xl`, `px-4 sm:px-6 lg:px-8`, `font-mono`,
  `min-h-screen`, body in `prose mx-auto mt-12`. Prose colours map to Nuxt UI tokens in `main.css`
  (`.site-prose`); the renderer's `prose-lg` size and padding are reset to plain `prose`.
- **The title is the first `h1` of the page body** (the package renders only the body). `main.css`
  gives it the source's `mb-20` (5rem). No second title is added anywhere.
- `<title>` = page title alone: the layout sets `titleTemplate: '%s'`, dropping core's `| <team>`.
- Light mode is pinned in `nuxt.config.ts` (`colorMode`).
- **Check cases:** 1–4 → `node pocs/kdm/scripts/check-public-routes.mjs <baseUrl>` (needs the
  seeded `welcome` page: `crouton-seed --db kdm-db` from `pocs/kdm`). 5–7 →
  `REVIEW_SEED_SECRET=… node pocs/kdm/scripts/check-browser-cases.mjs <baseUrl> --key pr<N>`
  (Playwright, real browser, signed in as the review login; screenshots to `screenshots/4153-case<N>.png`).
  Local dev needs `BETTER_AUTH_SECRET` in the environment.
- **Check cases after the team rename (#4488)** — both scripts default to team `kdm` (override with `TEAM=`):
  case 1 (`/kdm/en/welcome` 200, `/test1/en/welcome` 404 as `4488-1`) and case 5 (the #4153 cases
  still pass with `kdm`) → `node pocs/kdm/scripts/check-public-routes.mjs <baseUrl>`; case 2 (review
  login reaches `/admin/kdm/workspace` with the Pages admin) → `check-browser-cases.mjs` case 6.
  Config: `pnpm --filter kdm exec vitest run tests/team.test.ts`. The #4153 run log below is history
  (it used `test1`).
- **Run on the PR #4166 preview (2026-11-19):** 1 ✅, 2 ❌ (package gap below), 3 ✅, 4 ✅, 5 ✅
  (`/auth/login` ends on `/` with the sign-in form), 6 ✅ (the editor's "Open" goes to
  `/test1/en/welcome`, 200, `h1` "Welkom"), 7 partly: the pencil shows for the review login and opens
  the editing drawer, but the save step is not run, because the drawer's editor shows the seeded body as
  empty (package gap below) and saving would wipe the page.
- **Package gaps found (not fixed here — `packages/*` is out of scope for this step):**
  - `/test1/welcome` (no language) is a **404**, not a forward: crouton-pages only forwards `/test1`
    and `/test1/` to `/test1/en/`; a one-segment `/test1/<slug>` matches `[team]/[locale]/[...slug]`
    with `welcome` as the language and 404s. Case 2 fails until the package handles it.
  - The seeded `welcome` body (a `richTextBlock`) shows as an empty editor, both in the drawer and on
    `/admin/test1/workspace`; the public page renders it fine.
  - With one language the editor toolbar still shows an `EN` language button.
