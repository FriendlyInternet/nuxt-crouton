# CLAUDE.md — E2E Fixtures

**These are throwaway apps under test, not real products.** Each `fixtures/<name>/`
is a real, generated crouton app wired to a different set of packages, booted by
the Playwright harness in `e2e/` to prove a consuming app still **boots,
authenticates, and does CRUD** after a `packages/` change or dependency bump.

| Fixture | Exercises |
|---------|-----------|
| `minimal` | core + auth + i18n, one `items` collection (generic CRUD + locale-switch) |
| `with-pages` | + `@fyit/crouton-pages` → `@fyit/crouton-editor` (pages workspace surface) |
| `with-bookings` | + `@fyit/crouton-bookings` (bookings admin surface) |
| `with-assets` | + `@fyit/crouton-assets` (asserts the optional `CroutonAssetsPicker` mounts, not the core stub) |
| `with-collab` | + `@fyit/crouton-collab` (spike: asserts the realtime collab UI mounts single-client) |
| `with-maps` | + `@fyit/crouton-maps` (a `venues` collection with address+coordinate fields → asserts the MapLibre map mounts in the generated form + the `/api/maps/geocode` proxy geocodes against live Nominatim) |
| `with-sales` | + `@fyit/crouton-printing` + `@fyit/crouton-sales` (the full POS + printing domain → two-tier `printing.smoke` boots, places an order, and drives a print job pending → done against an in-test fake :9100 ESC/POS printer, asserting the order auto-completes) |
| `with-devtools` | + `@fyit/crouton-devtools` + `@fyit/crouton-feedback` (asserts the feedback "glasses" launcher mounts via devtools `installModule`) |

## What you need to know

- **Don't deploy these** and don't treat them as examples to copy — they exist
  only to be booted by the e2e harness. They're throwaway: each fixture's
  `.data/`, `.auth/`, `playwright-report/`, `test-results/` are gitignored.
- **To change what gets smoked, edit the fixture's `e2e.manifest.json`** — it
  declares the collections to CRUD and any package `surfaces` to assert. The
  shared specs in `e2e/` read it; you almost never write test code per fixture.
- **The manifest's `packages` list drives smart CI selection (#622).** It names the
  feature packages the fixture exercises, so a PR touching `packages/<pkg>` runs only
  the fixtures that list `<pkg>` (push to `main` + nightly still run all). Keep it
  current when a fixture starts/stops exercising a package. See `e2e/CLAUDE.md`.
- **They live in `fixtures/`, not `tests/`**, on purpose: pnpm ignores `test*/`
  during workspace discovery, so a fixture there would be invisible to
  `pnpm --filter`.
- **They're kept out of `apps/`** so they're never deployed or swept by app
  typecheck.
- **Each fixture commits a dummy `.env`** (`BETTER_AUTH_SECRET=dev-fixture-…`).
  Unlike real apps (where the scaffolded random secret stays gitignored), these
  are throwaway and never deployed, so the dev secret is committed — that's what
  lets a bare `pnpm dev` boot without anyone exporting `BETTER_AUTH_SECRET`. The
  e2e harness also injects the secret via `webServer.env`, so it works either way.

## Running a fixture standalone

To boot a fixture by hand (outside the Playwright harness), the committed `.env`
already supplies the auth secret, so just:

```bash
pnpm --filter e2e-fixture-minimal dev   # → http://localhost:3000
```

If you ever wipe the `.env`, the app fails with `[crouton/auth] BETTER_AUTH_SECRET
is required` — restore it (or export the var inline:
`BETTER_AUTH_SECRET=dev pnpm --filter e2e-fixture-minimal dev`). Running via the
`e2e-smoke` skill / `pnpm test:e2e` needs no env setup at all.

## Where the real docs are

The harness, the manifest format, the crouton-auth realities the smoke depends
on, the recipe for **adding a new fixture**, and the gotchas all live in
**`e2e/CLAUDE.md`** — read that before editing a manifest or adding a fixture.
To *run* the smoke, use the **`e2e-smoke` skill** (`.claude/skills/e2e-smoke/`).
