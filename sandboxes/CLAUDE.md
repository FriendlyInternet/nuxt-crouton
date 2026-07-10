# sandboxes/ — throwaway, spin-up-and-eyeball test apps

This folder holds **tiny, disposable apps whose only job is to let a human *look at*
something** — a component, a theme, a layout change — running for real, then get
deleted. They prove nothing automatically and incubate nothing. They are the
"let me just see it" drawer.

```
need to eyeball a change → spin up a sandbox here → look (local or preview URL) → delete it
```

## When to use this (vs pocs/ vs fixtures/)

| Folder | Purpose | Lives on? |
|---|---|---|
| `apps/*` | Production apps | Forever; full rigor |
| `pocs/*` | **Incubate a future package** — real feature code that will graduate into `packages/` | Until it graduates |
| `fixtures/*` | **Automated** Playwright e2e smoke (manifest-driven, runs in CI) | As long as the harness needs it |
| **`sandboxes/*`** | **Manual, human-eyeball verification of an *existing* change; delete-after** | Only as long as you're looking |

Pick `sandboxes/` when you just need to *see* an existing package/component change
rendered. Pick `pocs/` when you're building something that will become a package.
Pick `fixtures/` when you want an automated boot+CRUD check in CI.

## Rules (deliberately loose)

- **No issue-first, no CI gate, no i18n/translation rigor, no two-domain deploy.**
  Sandboxes are exempt the way `fixtures/` are — they're not products.
- **Keep them tiny.** Extend only what you're testing; no DB/auth/crouton unless the
  thing under test needs it. Hardcoded strings are fine.
- **Guarded `postinstall`** like every workspace app: `"nuxt prepare 2>/dev/null || true"`
  (a bare `nuxt prepare` breaks whole-monorepo installs — see root `CLAUDE.md`).
- **Delete when done.** A stale sandbox is clutter; remove the folder and its
  `sandbox:<name>` label entry when the thing it verified has landed.
- Build output (`.nuxt`, `.output`, `dist`, `node_modules`) is already gitignored
  globally — nothing to add.

## Spin one up

```bash
mkdir -p sandboxes/<name>/app
# package.json (guarded postinstall), nuxt.config.ts, app/app.vue — see any existing sandbox
pnpm install                       # registers the new workspace (sandboxes/* glob)
pnpm --filter <name> dev           # open the printed localhost URL
```

## Preview URL (shareable, from a phone / a link)

A sandbox preview deploys **only through CI** — that's where the Cloudflare
credentials live (`CLOUDFLARE_ACCOUNT_ID` / `CLOUDFLARE_API_TOKEN` repo secrets);
you can't produce a stable URL from a local/agent run without the token. Trigger it
**manually**, on demand:

> **Actions → "Deploy Sandbox (manual, Cloudflare Workers)" → Run workflow → enter the
> sandbox dir name**. The run summary prints the `https://<name>.workers.dev` URL.

To make a new sandbox deployable, give it:
- a minimal **`wrangler.jsonc`** — `name`, `compatibility_date`, `compatibility_flags: ["nodejs_compat"]`. No bindings, no routes, no `env` block → publishes to the zero-config `*.workers.dev` (no DNS/zone token scope, nothing to provision/migrate).
- a **`cf:staging`** script — `NITRO_PRESET=cloudflare_module nuxt build && npx wrangler deploy --config .output/server/wrangler.json`.
- **`wrangler`** in `devDependencies` (`catalog:`).

The deploy uses the thin **`.github/workflows/deploy-sandbox.yml`** (workflow_dispatch),
*not* the full `deploy-app.yml` app pipeline — sandboxes have no auth/DB to provision.
Staging-only; there is no production target for a sandbox.

## Tracking

Each sandbox gets a `sandbox:<name>` label in `.github/labels.yml` (mirrors
`poc:<name>`), added via labels-as-code and synced on merge to `main`.

## What lives here now

_(none — the `minimal-theme-demo` sandbox that verified the `minimal` theme's flat
buttons was retired in #1306: its job is now served by the in-package
`packages/crouton-themes/playground/` theme gallery, which covers every theme, not
just one.)_
