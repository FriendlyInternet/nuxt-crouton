# kdm — HANDOFF

Kasper Demeulemeester's site (kasperdemeulemeester.be), moving from Nuxt Content + Decap/Netlify
onto crouton so pages can be edited in the browser. Epic: https://github.com/FriendlyInternet/nuxt-crouton/issues/4125

Status: scaffold only (#4126) — empty crouton app with Pages, Assets, Editor and i18n, deployed as a
staging preview at https://kdm.pmcp.dev. No content, no custom layout, default pages routing yet.

## Decisions (from epic #4125)

- [2026-11-18] App lives at `pocs/kdm`, not `apps/` → repo rule: new apps start in `pocs/`, move to `apps/` at production launch.
- [2026-11-18] The markdown content is committed as seed input → the source repo `pmcp/kdm` and the live site are already public, so nothing new is published.
- [2026-11-18] Drop `test.md`; merge the two identical-titled album pages into one with a redirect → one is a leftover test, the other a duplicate slug of the same page.
- [2026-11-18] Old page addresses are kept exactly → existing links to the site keep working when the domain moves later.
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
