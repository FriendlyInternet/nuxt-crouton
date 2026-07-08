# bookmark-stash (POC)

A tiny single-collection crouton app — a personal bookmark keeper. Epic #1209.

> **Status: scaffolded + generated (WS2, #1213).** The `bookmarks` collection is generated
> from the WS1-approved schema (#1212), the app boots locally, and 3 sample bookmarks are
> seeded. WS3 (#1214) deploys the staging preview and refines the UI.

## Collection: `bookmarks`

| Field   | Type            | Required | Notes                                             |
|---------|-----------------|----------|---------------------------------------------------|
| title   | string          | yes      | max 200                                           |
| url     | string          | yes      | max 2048 — the bookmarked link                    |
| tags    | string          | no       | comma-separated (no relation table for this POC)  |
| notes   | text (long)     | no       |                                                   |

`teamId` / `owner` / `createdAt` are auto-injected by the crouton generator (team scoping),
so they are not declared in the fieldsFile.

## Local dev

```bash
pnpm install
pnpm build:packages   # once, from repo root — apps consume @fyit/* from packages/*/dist
pnpm --filter bookmark-stash dev
```

Boots at `http://localhost:3000`. `hub: { db: 'sqlite' }` uses a local NuxtHub sqlite DB at
`.data/db/sqlite.db` (gitignored, created on first `dev` run — separate from the Wrangler-local
D1 under `.wrangler/`, see the `crouton-run-and-operate` skill for the split).

### Seed sample data

The generator emitted an editable fixture at
`layers/main/collections/bookmarks/seed.json` (3 sample rows — a Nuxt doc, a Vue guide, a
Cloudflare pricing page). After `pnpm dev` has run once (so `.data/db/sqlite.db` and its
migrations exist), seed it directly:

```bash
sqlite3 .data/db/sqlite.db < path/to/seed.sql   # see seed.json for the row content
```

(A full `crouton-seed` run also works once the app only extends layers with matching
generated migrations — see the note in the epic for the current `crouton-seed` package-scan
gap tracked separately.)

## Layout

`crouton.layout.json` composes a deterministic master-detail layout (list + form panes) via
`@fyit/crouton-layout`, wired into `nuxt.config.ts` `extends`.
