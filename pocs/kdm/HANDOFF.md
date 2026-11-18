# kdm — HANDOFF

Kasper Demeulemeester's site (kasperdemeulemeester.be), moving from Nuxt Content + Decap/Netlify
onto crouton so pages can be edited in the browser. Epic: https://github.com/FriendlyInternet/nuxt-crouton/issues/4125

Status: plain public addresses + Kasper's look (#4153). Pages made in the editor show at `/<slug>`;
`/` shows the page with slug `home`. No imported content yet — until the import step there is no
`home` page, so `/` is a 404 on a fresh deploy (expected). Staging preview: https://kdm.pmcp.dev.

## Decisions (from epic #4125)

- [2026-11-18] App lives at `pocs/kdm`, not `apps/` → repo rule: new apps start in `pocs/`, move to `apps/` at production launch.
- [2026-11-18] The markdown content is committed as seed input → the source repo `pmcp/kdm` and the live site are already public, so nothing new is published.
- [2026-11-18] Drop `test.md`; merge the two identical-titled album pages into one with a redirect → one is a leftover test, the other a duplicate slug of the same page.
- [2026-11-18] Old page addresses are kept exactly → existing links to the site keep working when the domain moves later.
- [2026-11-18] Public routing: `croutonPages.routingMode: 'custom'` + app-level `app/pages/index.vue` and `app/pages/[slug].vue` (in the app, not a `layers/site` layer — one site, nothing to share) → plain addresses with no team or locale. Both pages read through the package's own `GET /api/teams/test1/pages/<slug>?locale=en` (publish + visibility checks live there) via `app/composables/useSitePage.ts`; rejected: alexdeforce's `/api/public/pages/[slug]` (no team/visibility check).
- [2026-11-18] On staging the site's one team is the demo team `test1`, not a team called `kdm` → every preview attaches the review login to `test1` only, so content and login must share that team; the name never shows in a public address.

## What the scaffold learned (#4126)

- Scaffolded with `crouton init kdm --poc --features pages,assets,editor,i18n -d sqlite`, **without**
  `--domain`: with `--domain` the CLI writes a top-level (production) route plus `kdm-staging.pmcp.dev`,
  which is the wrong shape. The staging-only route `kdm.pmcp.dev` lives under `env.staging.routes`.
- `cf:version` (used by the previews workflow) is not written by the CLI — added by hand, same line as `pocs/snippets`.
- Blob storage: the CLI writes no `r2_buckets` and `hub.blob` was off — both added by hand
  (`kdm-blob`, `kdm-staging-blob`, pattern from `pocs/crate`). Whether the deploy creates a missing
  bucket by itself is unverified; if the preview fails on the bucket, that's an owner action (report on the epic).
- `@fyit/crouton-devtools` moved to `dependencies`; `vitest` set to `catalog:`.
- Single-team auth: `croutonAuth.teams = { defaultTeamSlug: 'test1', allowCreate: false, showSwitcher: false, showManagement: false }`.
- Colour mode pinned to light (`kdm-color-mode`).

## What public routing learned (#4153)

- `useHead`/`useFetch` must run **before** the first `await` in `useSitePage` — calling `useHead`
  after `await useFetch` lost the Nuxt context and every page 500'd.
- crouton-core's `app.vue` titleTemplate appends the team name (`Welkom | Test 1`); public pages and
  `app/error.vue` set `titleTemplate: '%s'` so `<title>` is the page title only.
- `app/error.vue` replaces core's error page (which links to the dashboard) with the plain look.
- Layout `app/layouts/site.vue` = source `default.vue` (max-w-4xl, px-4/6/8, font-mono, min-h-screen);
  prose colours map to Nuxt UI tokens in `main.css` (`.site-prose`), `@tailwindcss/typography` enabled.
- The team slug `test1` still appears in the SSR payload (runtime config + page data), never in an
  address or visible text.
- Route check: `node pocs/kdm/scripts/check-public-routes.mjs <baseUrl>` (needs `welcome`, `draft-page`,
  `home`, `members-page` rows — see the script header). Local dev needs `BETTER_AUTH_SECRET` in the
  environment or the members-only case 500s.
