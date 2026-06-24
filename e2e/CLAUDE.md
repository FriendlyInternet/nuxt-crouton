# CLAUDE.md — E2E Test Harness

End-to-end smoke tests that prove a **real generated crouton app** still boots,
authenticates, and does CRUD. Run them when bumping dependencies or changing
crouton packages — if a consuming app would break, this catches it.

## Layout

```
e2e/                         # the harness (Playwright) — NOT a workspace package
  playwright.config.ts       # config; targets a fixture, sets up projects + webServer
  helpers.ts                 # shared, non-test module (config, auth flow, manifest loader)
  auth.setup.ts              # 'setup' project: log in / register + create team, save state
  auth.smoke.spec.ts         # auth feature itself: logout/re-login, logged-out guard, team switch
  collection.smoke.spec.ts   # generic, manifest-driven list + CRUD checks
  surface.smoke.spec.ts      # generic, manifest-driven package-surface checks (optional)
  i18n.smoke.spec.ts         # generic, manifest-driven locale-switch check (optional)
  maps.smoke.spec.ts         # generic, manifest-driven maps mount + live geocode check (optional)
  printing.smoke.spec.ts     # with-sales only: two-tier order→print→done smoke vs an in-test fake :9100 printer (optional)
  .auth/                     # generated storageState + team slug (gitignored)

fixtures/                    # the apps under test — real crouton apps, one per config
  minimal/                   # core + auth + i18n, one 'items' collection
  with-pages/                # + @fyit/crouton-pages   (surface: pages workspace)
  with-bookings/             # + @fyit/crouton-bookings (surface: bookings admin)
  with-assets/               # + @fyit/crouton-assets  (surface: CroutonAssetsPicker mounts, not the stub)
  with-collab/               # + @fyit/crouton-collab  (spike surface: realtime collab UI mounts single-client)
  with-maps/                 # + @fyit/crouton-maps    (maps: map mounts in form + live Nominatim geocode)
  with-sales/                # + @fyit/crouton-printing + @fyit/crouton-sales (two-tier print smoke vs an in-test fake :9100 printer)
  <name>/                    # add more here
    e2e.manifest.json        # declares what to smoke (collections, fields)
```

> ⚠️ Fixtures live in `fixtures/`, **not** `tests/`: pnpm hardcodes ignoring
> `test/` and `tests/` directories during workspace discovery, so a fixture app
> there would be silently invisible (`pnpm --filter` finds nothing).

## Running

```bash
pnpm test:e2e                          # default fixture (minimal)
E2E_FIXTURE=with-pages pnpm test:e2e   # another fixture
```

> **The auth env is now self-provided** — `webServer.env` in `playwright.config.ts`
> defaults `BETTER_AUTH_SECRET` to `dev` and `BETTER_AUTH_URL` to
> `http://localhost:3000`, and each fixture also commits a dummy `.env`. So no
> env prefix is needed locally. Exporting `BETTER_AUTH_SECRET`/`BETTER_AUTH_URL`
> still works and **overrides** the defaults (this is how CI passes its
> placeholder). If a fixture's committed `.env` is wiped *and* nothing is
> exported, crouton-auth refuses to mint sessions and `auth.setup.ts` fails with
> "Could not authenticate test user."

The config's `webServer` boots `pnpm --filter e2e-fixture-$E2E_FIXTURE dev` on
`:3000` (or reuses a server already running there). One fixture per run — they
all use port 3000. Each fixture has its own local sqlite DB under `.data/`.

> A fresh checkout/worktree must **build the fixture's workspace deps first** (the
> dist-consumed `@fyit/*` packages), or the dev server can't load `@fyit/crouton`:
> `pnpm --filter "e2e-fixture-<name>^..." build` (this is what CI does).

### Type-safety gate (#197)

Each fixture carries a `tsconfig.json` (`extends ./.nuxt/tsconfig.json`) **so its
type-check stays scoped to that fixture** — without it `vue-tsc` walks up to the
root `tsconfig.json` (`include: ["**/*"]`) and type-checks the whole monorepo
(10k+ false positives). Every fixture has a `typecheck` script:

```bash
pnpm --filter e2e-fixture-with-pages typecheck   # one fixture
pnpm typecheck:fixtures                            # all fixtures (root script)
```

CI (`.github/workflows/e2e.yml`) **regenerates each fixture from its committed
schemas, then type-checks it** before the Playwright smoke — so a generator
template regression (the class of bug behind #195) turns CI red instead of only
surfacing when someone scaffolds a new app. Keep the committed fixture output in
sync: after changing a generator template, regenerate the fixtures
(`cd fixtures/<name> && crouton config --force`) and commit the result.

## How it works

1. **setup** (`auth.setup.ts`) runs first: logs the test user in (registering on
   first run), ensures a team exists, saves `storageState` → `.auth/user.json`
   and the team slug → `.auth/team.json`.
2. **chromium** runs `*.smoke.spec.ts` with that storageState, both reading the
   active fixture's `e2e.manifest.json`:
   - `collection.smoke.spec.ts` — for each collection, checks the list page loads
     and runs a create → see-in-list → delete cycle.
   - `surface.smoke.spec.ts` — for each declared `surface`, visits the route and
     asserts its element/heading renders. Fixtures with no `surfaces` register no
     surface tests (the file is a no-op for them).

### crouton-auth realities the harness depends on
- Login/register happen in a **RouteModal overlay**, not a form page.
  `/auth/login` redirects to `/` and opens the modal (`useAuthModal`).
- **Signup creates no team.** We create one via the better-auth org API
  (`POST /api/auth/organization/create` + `/set-active`), which **requires an
  `Origin` header** (CSRF) — see `ensureTeam()`.
- **Better-auth POSTs require `Content-Type: application/json`** — it rejects a
  bodyless POST with 415. Pass `data: {}` to `page.request.post` so Playwright
  sets the header (this bit `signOut()`; the team helpers already send a body).
- **get-session is cookie-cached** (better-auth `session.cookieCache`, 5-min
  signed cookie), so it can report a *stale* user for up to 5 min after sign-out.
  `getSession()` passes `?disableCookieCache=true` to force a DB read — use it
  (via `isAuthenticated`) whenever a spec needs the *true* post-logout state.
- **Auth specs must run in their own context, not the shared `storageState`.**
  Every spec reuses setup's saved session token; better-auth sign-out destroys
  the *current* session, so logging out (or switching team on) the shared session
  invalidates the token every other spec depends on. `auth.smoke.spec.ts` mints a
  separate session per test via `browser.newContext()` + `loginOrRegister`.
- Generated collections render at `/admin/{teamSlug}/crouton/{collectionKey}`
  (e.g. `mainItems`).

## Adding a new fixture

```bash
# 1. Scaffold (outside tests/!). Pick the packages to exercise.
node packages/crouton-cli/bin/crouton-generate.js init with-i18n --features i18n --noCf
#    add an items collection (copy fixtures/minimal/schemas + crouton.config.js), then:
cd apps/with-i18n && node ../../packages/crouton-cli/bin/crouton-generate.js config

# 2. Relocate + rename
mv apps/with-i18n fixtures/with-i18n
#    set package.json "name": "e2e-fixture-with-i18n"

# 3. Declare what to smoke (incl. `packages` so smart CI selection runs it on the right changes)
cat > fixtures/with-i18n/e2e.manifest.json <<'JSON'
{ "packages": ["crouton-i18n"], "collections": [ { "key": "mainItems", "heading": "Main Items", "create": { "name": "e2e item" } } ] }
JSON

# 4. Register + run
pnpm install
E2E_FIXTURE=with-i18n pnpm test:e2e

# 5. Add it to the CI matrix: append the fixture name to ALL="…" in .github/workflows/e2e.yml
#    (the detect job's candidate list). Without this it runs locally but never in CI.
```

`fixtures/*` is already a workspace glob, so step 4's install picks it up.
**No new test code** — the generic spec covers any fixture via its manifest.

### Smart CI selection (#622)

`e2e.yml` doesn't run every fixture on every change. A `detect` job (mirroring
`deploy-pocs.yml`) computes the matrix from the changed paths + each manifest's `packages`:

- `packages/<pkg>/**` → every fixture whose `packages` lists `<pkg>`; a package no fixture
  covers → `minimal` (baseline boot).
- `fixtures/<name>/**` → that fixture.
- **Universal** (`crouton`, `crouton-core`, `crouton-i18n`, `crouton-cli`, `crouton-auth`,
  `e2e/**`, `pnpm-lock.yaml`, the workflow) → **all** fixtures.
- **Backstops:** push to `main` and the **nightly schedule** always run the full matrix, so
  selection can never silently hide a regression.

When you add a fixture, set its `packages` (step 3) **and** add it to `ALL` in the workflow
(step 5) — otherwise the detect job never selects it.

### Manifest format
```jsonc
{
  // Feature packages this fixture exercises ON TOP OF the shared base (core/i18n/auth).
  // Drives smart CI selection (#622): a PR touching packages/<pkg> runs only the fixtures
  // whose `packages` list includes <pkg>. Include meaningful transitive deps the fixture
  // actually renders (e.g. with-pages lists crouton-editor, which crouton-pages pulls in).
  // Leave `[]` for a baseline fixture (minimal) — it always runs for uncovered/core changes.
  "packages": ["crouton-pages", "crouton-editor"],
  "collections": [
    {
      "key": "mainItems",          // route segment + registered config key
      "heading": "Main Items",      // visible list heading to assert
      "create": { "name": "e2e item" },  // text field label/name -> value; omit to skip CRUD
      "update": { "name": "renamed" },   // optional edit values; default = first field + " edited"
      "requiredField": "name"            // optional: clear this field to assert validation blocks submit; omit to skip
    }
  ],
  // Optional: package-specific UI a generic items CRUD doesn't reach. Omit when a
  // fixture has nothing extra to assert (e.g. minimal). Proves the *package* mounts,
  // not just that the app boots — e.g. with-pages asserts the pages workspace.
  "surfaces": [
    {
      "name": "pages workspace renders",         // test title
      "path": "/admin/{team}/workspace",          // route; {team} -> active team slug
      "expect": { "visible": "[id$='-panel-pages-sidebar']" }  // CSS selector that must be visible
      // or: "expect": { "heading": "Workspace" } // a role=heading name (case-insensitive)
    }
  ],
  // Optional: a locale-switch check (crouton-i18n). A `surface` can only assert a
  // static element renders; this one *interacts* — flips locale via the
  // package-owned LanguageSwitcher and asserts a known UI string changes
  // language, so an i18n regression goes red. Needs ≥2 configured locales
  // (set `locales`/`defaultLocale` in the fixture's crouton.config.js). Omit for
  // single-locale fixtures (i18n.smoke.spec.ts then registers no test).
  "i18n": {
    "path": "/",            // page rendering the switcher + a translated string; {team} substituted
    "switchTo": "NL",        // switcher option to pick (uppercase locale-code label)
    "before": "Your teams",  // a known translated string in the default locale
    "after": "Jouw teams"    // the same string in the target locale
  },
  // Optional: a maps + geocoding check (crouton-maps). Two assertions —
  // (1) the CroutonMapsMap mounts inside the collection's generated create form
  // (offline-safe; always runs), and (2) the /api/maps/geocode proxy forward-
  // geocodes an address. The geocode step hits LIVE public Nominatim, so it
  // skips gracefully when the network is blocked (a CI runner must not go red).
  // Omit for fixtures that don't extend crouton-maps.
  "maps": {
    "collectionKey": "mainVenues",   // collection whose generated form embeds the map
    "heading": "Main Venues",         // that collection's list heading
    "formTab": "Address",             // optional: form tab the map field lives on (UTabs
                                      //   content is lazy; omit if the map is on the first tab)
    "geocode": {
      "query": "Eiffel Tower, Paris, France", // address to forward-geocode
      "near": [2.2945, 48.8584],              // expected [lng, lat]
      "tolerance": 2                           // allowed deviation in degrees (generous)
    }
  }
}
```

> Surface selectors should hook something the *package* owns (here, the
> `sidebar-id="pages-sidebar"` crouton-pages sets on `CroutonWorkspaceLayout` —
> Nuxt UI renders the panel DOM id as `<storageKey>-panel-pages-sidebar`, hence
> the ends-with match), so the assertion fails if that package's UI regresses.
> The `i18n` check works the same way: the switcher is crouton-i18n's
> `LanguageSwitcher` (a Nuxt UI `USelect` → the page's locale combobox) and the
> asserted string is crouton's own `home.*` label, so a broken switcher or stuck
> locale fails it.

## Visual-QA artifacts (#356)

The smoke doesn't just gate green/red — it records what it does, so any PR (a dep
bump, a `packages/` change, a UI tweak) yields **reviewable visual proof**. This is
Playwright-native capture, no custom infra (`use` in `playwright.config.ts`):

- `trace: 'on'` — an interactive step-by-step timeline with a before/after
  **screenshot of every action**, DOM snapshots, network, and **console logs**
  (the console matters most for a component-library bump — silent Vue warnings show
  here). Open with `npx playwright show-trace <trace.zip>` or drag onto
  [trace.playwright.dev](https://trace.playwright.dev).
- `video: 'on'` — a `.webm` clip of the full boot → login → CRUD → surface run,
  watchable like a Loom.
- `screenshot: 'on'` — a final screenshot per test.

In CI the **HTML reporter** bundles all three into one self-contained
`playwright-report/`, uploaded as artifact **`visual-qa-<fixture>` on every run**
(`if: always()`, 14-day retention — see `.github/workflows/e2e.yml`). To review:
PR → Actions run → **Artifacts** → download `visual-qa-<fixture>` → open
`index.html`. (Artifacts download as a zip; they don't render inline in the PR.)

Locally, `pnpm test:e2e` writes the same HTML report to `playwright-report/`
(`npx playwright show-report` to open). Out of scope for now: `toHaveScreenshot()`
pixel-diff baselines (flake-prone, separate follow-up) and screenshotting the live
staging deploys.

## Gotchas
- **Module format:** repo root is CommonJS, and Playwright 1.57 transpiles
  config/specs to CJS — use `__dirname`/`join`, **not** `import.meta.url`
  (it forces ESM output → "exports is not defined").
- **Specs can't import test files** (Playwright rule) — shared constants like
  `TEAM_FILE` live in `helpers.ts`, not `auth.setup.ts`.
- **Cold dev-server compile (the big one for CI):** the smoke runs against
  `nuxt dev`, which compiles each route/modal on first hit. CI runners are far
  slower at this than locally — heavy package routes can take minutes — so the
  first-hit assertions use **very generous** timeouts (180s, with a 240s per-test
  budget and a 120s nav/modal cap). Keep them high: a high cap costs nothing when
  a route compiles fast (the assertion resolves as soon as the element appears);
  it only matters on a genuinely slow first compile. Tightening them back to
  ~30-60s is what made the CI smoke flake. (Precompiled `nuxt preview` would dodge
  this, but crouton collection pages currently 500 under production SSR — an
  internal data-fetch loses the auth cookie — so the harness stays on `nuxt dev`.)
- Fixtures are throwaway: `.data/`, `.auth/`, `playwright-report/`,
  `test-results/` are all gitignored.

## Scope / follow-ups
Current: list loads + full CRUD per collection (create → edit → delete, plus an
optional `requiredField` invalid-submit check), plus optional package-specific
`surfaces` (e.g. with-pages asserts the pages workspace mounts). CI wiring runs the matrix
over `fixtures/*` (see `.github/workflows/e2e.yml`). `with-bookings` is the
domain-package example: it boots a heavy package (locations/settings/slots) and
asserts the bookings admin UI via `surfaces`. Adding such a fixture is also how the
harness caught a real crouton-cli scaffolder bug (#172) — generators that emit
broken code get caught at boot.
