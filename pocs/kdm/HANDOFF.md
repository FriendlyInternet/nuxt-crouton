# kdm — handoff

Kasper Demeulemeester's site, moved onto crouton so he can fill and change his pages
himself (through Claude), with no hand-written site code.

- Epic: https://github.com/FriendlyInternet/nuxt-crouton/issues/4125
- This step: https://github.com/FriendlyInternet/nuxt-crouton/issues/4526 (empty site, team `kdm`, plain look from settings only)
- Staging (PR previews): https://kdm.pmcp.dev — no production address (POC)

## Decisions that still apply (from the epic)

- **18 Nov** — the site lives in `pocs/` (POC stage: safe-to-fail, preview deploys only).
- **19 Nov** — normal crouton team routing (`/kdm/<page>`), no hand-written routes. A page's
  title is the first `h1` of its body. Pages are filled through Claude.
- **24 Nov** — option C: the look comes from settings and CSS only. No `app/pages`,
  `app/layouts`, `server/middleware` or `routingMode`; no edit pencil on the public page.
- **25 Nov** — fresh start from main; the first attempt's branch is archived
  (`archive/epic/4125--v1-move-kasper-s-site-kdm-onto-crouton-so`).

## What the CLI wrote

One command from the repo root (dry run first, then the real run):

```
node packages/crouton-cli/bin/crouton-generate.js init kdm --site --poc --domain pmcp.dev --features pages,assets,editor -d sqlite
```

It wrote the app (features core, editor, pages, assets, layout), the first migration,
the staging-only route `kdm.pmcp.dev`, one locale (`en`) with `hideLocaleInUrl`, empty
`appDomains`, team switcher/creation/management off, passkeys off, and the guarded
`postinstall` (`nuxt prepare 2>/dev/null || true`). `pnpm-lock.yaml` got the new importer
from `pnpm install --lockfile-only` (a full `pnpm install --no-frozen-lockfile` re-resolved
TypeScript peers across the whole lockfile, so it was redone lockfile-only).

## Fixed by hand

- `nuxt.config.ts` — `defaultTeamSlug: 'test1'` → `'kdm'`, and the comment above it (the
  CLI's copy said the team is `test1`). Added `colorMode` light only, `storageKey: 'kdm-color-mode'`.
- `deploy.config.json` — added `"reviewTeam": "kdm"`, so every preview seeds team `kdm` and
  signs the review login in there (`scripts/review-team.mjs`).
- `app/assets/css/main.css` — Kasper's look, aimed only at crouton-pages' own public page
  (`.page-view`, used only by `PublicPage.vue`, so admin screens are unaffected): 56rem
  column, monospace, 65ch text width, 3rem top margin, the title `h1` with 5rem below it.
- `.github/labels.yml` — `poc:kdm`.
- `package.json` — `cf:staging` / `cf:deploy` switched to `scripts/deploy-order.mjs`
  (database changes before the new code goes live), copied from `pocs/pins`; the CLI still
  writes the old order (`scripts/deploy-order.test.mjs` T9/T14 refuse it).
- `package.json` — `test` script is `vitest run --passWithNoTests`, so `pnpm test` stays
  green on a POC that has no unit tests of its own.
- `scripts/review-team.test.mjs` — its whole-repo check expected every app on team `test1`;
  it now expects each app's own `reviewTeam` (default `test1`), since kdm is the first app
  that names its own.
- The CLI writes one first migration that creates every table. Two whole-repo migration
  checks were written for older apps' upgrade histories and refused that shape for kdm.
  Owner picked option A on #4526 (25 Nov 13:40): a brand-new app's first migration may
  create everything at once.
  - `scripts/team-roles-migrations.test.mjs` — organizationRole no longer has to sit in a
    migration of its own when an app's first migration creates it together with `member`
    (`orgRoleProblem`); a later migration that adds it with other tables is still refused.
  - `scripts/verify-existing-users-migration.test.mjs` — an app whose first migration
    creates `user` has no older users to mark verified, so it needs no such step or list entry.
- `packages/crouton-pages/test/public-routes-corpus.test.ts` — skips apps that switch
  `hideLocaleInUrl` on (owner yes, 25 Nov 13:40).

## Check cases (run 25 Nov, locally on `pnpm preview kdm`; re-run on the PR #4549 preview — same results)

| Case | Result | Tool |
|---|---|---|
| Settings-and-CSS-only rule, team kdm twice, guarded postinstall, light mode, one locale, label | pass (13/13) | `node pocs/kdm/scripts/check-scaffold.mjs` |
| Review team resolves to `kdm` | pass | `node scripts/review-team.mjs pocs/kdm` |
| 1 `/kdm/welcome` → 200, one `h1`, no menu, no footer | pass (answered on the plain address, no `/en`) | `check-public-routes.mjs` |
| 2 `/kdm/does-not-exist-4526` → 404 | pass | `check-public-routes.mjs` |
| 3 `/test1/welcome` → 404 | pass | `check-public-routes.mjs` |
| 4 `/` → 200, crouton start page | pass | `check-public-routes.mjs` |
| 5 signed out, `/auth/login` → ends on `/` with the sign-in form | pass | `check-browser-cases.mjs --case 5` (Playwright) |
| 6 review login lands in team `kdm` | pass | `check-browser-cases.mjs --case 6` (Playwright) |
| 6 `/admin/kdm/workspace` shows the Pages admin with "Welkom" | pass | `check-browser-cases.mjs --case 6` (Playwright) |
| 6 the demo page opens in the editor **with its text** | **not passed — waits on [#4436](https://github.com/FriendlyInternet/nuxt-crouton/issues/4436)** | `check-browser-cases.mjs --case 6` (Playwright) |
| Kasper's look matches https://kasperdemeulemeester.be/t-i-c/ | manual, open | a person, side by side |

Run them again on the PR preview:

```
node pocs/kdm/scripts/check-public-routes.mjs https://kdm.pmcp.dev
REVIEW_SEED_SECRET=… node pocs/kdm/scripts/check-browser-cases.mjs https://kdm.pmcp.dev --key pr<N>
```

## Connect Claude (#4493)

Claude edits Kasper's pages through the same page tools velo has (`croutonMcpToolkit:
{ enabled: true, genericTools: false, pages: true }` — page tools only, no generic
collection or token tools). Claude signs in, no key (`croutonAuth.mcpOAuth: true`).

1. In the Claude app: Settings → Connectors → **Add custom connector**.
2. Paste `<preview origin>/mcp` (for example `https://kdm.pmcp.dev/mcp`, or the PR preview's address).
3. Claude opens the kdm sign-in page; sign in and allow access.
4. Ask Claude to list the pages of team `kdm` and change the demo page's text. With the page
   open in the editor, the change shows up live (live sync: `"collab": true` in
   `deploy.config.json` deploys the sync worker).

What changed for this (#4493): `@fyit/crouton-collab` + `@fyit/crouton-mcp-toolkit` added
(package.json, `extends`, `layerPackages` incl. `@fyit/crouton-auth`), the two settings above,
`global_fetch_strictly_public` in `wrangler.jsonc` (so the app can reach the sync worker), and
the deploy smoke reads for `/mcp` (401), `/mcp/pages` (404), both `/.well-known/oauth-*`,
`/api/auth/oauth2/get-consents` and the collab token. **No new migration:** the CLI's first
migration (`0000_*`) already creates the sign-in tables (`jwks`, `oauth*`), so
`pnpm db:generate` reports "No schema changes".

| Case (#4493) | Result (25 Nov, local `pnpm preview kdm`) | Tool |
|---|---|---|
| T6 config: page tools only, sign-in on, collab, flag, smoke reads, sign-in tables migrated | pass (8/8) | `pnpm --filter kdm exec vitest run tests/mcp-config.test.ts` |
| T7 `/mcp` no token and `Bearer x` → 401 with `WWW-Authenticate`; protected-resource names `<origin>/mcp` | pass | `check-public-routes.mjs` cases 7a–7c |
| T8 signed in, `/api/auth/oauth2/get-consents` → 200 | pass | `check-browser-cases.mjs --case 8` (no browser needed) |
| T9 Claude connects and edits a page live | manual, open | a person with a Claude account |

## Known package gaps

- **The seeded demo page opens with an empty editor body** — not passed, waits on
  [#4436](https://github.com/FriendlyInternet/nuxt-crouton/issues/4436) (fix in PR #4465).
  crouton-pages seeds the page as one `richTextBlock`; the public page renders it, but the
  editor has no node for that block type and drops it. Re-check case 6 once #4465 reaches
  this branch: the script then prints `case 6 (editor body): PASS`.

## Notes for the next step

- The admin sidebar shows the team's display name as "Test 1" (it comes from the seed); the
  address is `kdm`. It never shows on the public page.
- The sign-in button is crouton-auth's round button, bottom-left of the public page.
- The page title `h1` renders at body size in the monospace look — compare with Kasper's
  site during the manual look check.
- Locally, `pnpm preview kdm` on a brand-new database tried to seed before the dev server
  had migrated it; re-running `pnpm --filter kdm exec crouton-seed --db kdm-db --team kdm`
  and `scripts/seed-review-login.mjs` once the server was up fixed it. (Seen again 25 Nov,
  #4493: the review login got HTTP 503; re-running `seed-review-login.mjs` fixed it.)
- Locally, `/mcp` and `/.well-known/oauth-*` answer 500 unless `BETTER_AUTH_SECRET` is set
  for `pnpm preview kdm` (deploys set it).
