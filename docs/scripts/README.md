# docs/scripts

## sync-changelogs.ts

> **Status: LIVE — this is the only implementation (corrected 2026-08-05, #1943).**
> It was marked SUPERSEDED on 2026-04-07 in favour of ThinkGraph Phase 2A
> ("Repo watchlist + daily digest"), but **thinkgraph was itself retired on
> 2026-07-01** (#1043), so the replacement no longer exists. The supersession
> below is kept as history — do not act on it.
>
> Meanwhile #164 relocated `apps/docs` → top-level `docs/` on 2026-06-15 and the
> workflow's `working-directory` was missed, so every run failed silently for seven
> weeks and the `/changelogs` page served stale data. Fixed in #1943; if this page
> looks frozen again, check that workflow's paths first.

Fetches GitHub releases for tracked packages, generates AI summaries, and
writes them to `data/changelog-releases.json`. Runs daily via the
`sync-changelogs` GitHub Action.

### What was going to replace it (historical — thinkgraph is retired, #1043)

The plan was to do the same job inside the `thinkgraph` app. That app was archived
to `retired/pocs/` on 2026-07-01, so none of the below is running. Kept only as a
design sketch in case the job ever moves off a committed JSON file:

- **Storage**: D1 instead of a JSON file in this repo. Two collections:
  - `thinkgraph_watchedrepos` — the watchlist (repo, branch, lastCheckedSha,
    notes, active).
  - `thinkgraph_watchreports` — one row per run, with markdown summary,
    raw commit list, and any nodes spawned from the digest.
- **Trigger**: `POST /api/cron/watch-repos` on the thinkgraph app, secured
  by `WATCH_REPOS_CRON_SECRET`. Wire it to a Cloudflare cron trigger or
  any external scheduler.
- **Runner**: `apps/thinkgraph/server/utils/watch-repos.ts`. Walks all
  active watched repos, fetches commits since `lastCheckedSha` from the
  GitHub API, generates a markdown digest with the project's standard AI
  helper, writes a `watch_reports` row, and (optionally) creates an idle
  "watch digest" node so the digest surfaces on the canvas.

### Migration path

1. Backfill the new `thinkgraph_watchedrepos` table from
   `apps/docs/data/changelog-packages.json`.
2. Point the docs changelog UI at `thinkgraph_watchreports` (or keep its
   own JSON cache, fed by the new endpoint).
3. Disable the `sync-changelogs.yml` workflow and delete this script.
