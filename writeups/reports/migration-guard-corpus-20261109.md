# Migration guard — corpus replay (#3621)

Run at HEAD `e5f58a6d4` on 2026-11-09. Discovered 24 merged schema PRs.

Command: `node scripts/migration-guard-corpus.mjs --worktree /tmp/mg-wt --cache /tmp/mg-cache`

"Guard would have said" = the merged guard run on the merge commit as-is. "Flagged" = statements the PR itself introduced (merge minus parent). Verdicts marked *likely* are checked by eye in the final column.

| PR | merged | base | guard would have said | apps flagged (introduced by this PR) | real / false alarm | note |
|---|---|---|---|---|---|---|
| #3572 | 2026-11-07 | main | fail | apps/kassa (3 stmt), apps/velo (3 stmt), pocs/crate (3 stmt), pocs/gallery (3 stmt), pocs/status (3 stmt) | apps/kassa: likely false alarm: migration present, snapshot missing; apps/velo: likely false alarm: migration present, snapshot missing; pocs/crate: likely real: no migration; pocs/gallery: likely real: no migration; pocs/status: likely real: no migration | 10 files |
| #3439 | 2026-11-06 | main | fail | none (pre-existing drift only) | — | 80 files |
| #2984 | 2026-10-28 | main | fail | pocs/gallery (7 stmt) | pocs/gallery: likely real: no migration | roll-up of #2850, #2726; 64 files |
| #2850 | 2026-10-28 | epic/801-venue-onboarding-config-sync | fail | pocs/gallery (6 stmt) | pocs/gallery: likely real: no migration | 21 files |
| #2845 | 2026-10-27 | epic/801-venue-onboarding-config-sync | fail | none (pre-existing drift only) | — | 10 files |
| #2799 | 2026-10-27 | epic/801-venue-onboarding-config-sync | fail | none (pre-existing drift only) | — | 28 files |
| #2743 | 2026-10-27 | main | fail | none (pre-existing drift only) | — | 32 files |
| #2726 | 2026-10-27 | epic/801-venue-onboarding-config-sync | fail | apps/kassa (1 stmt), pocs/gallery (1 stmt) | apps/kassa: likely real: no migration; pocs/gallery: likely real: no migration | 16 files |
| #2669 | 2026-10-26 | epic/2606-status-pill-show-the-team-s-recent-chang | fail | none (pre-existing drift only) | — | 17 files |
| #2552 | 2026-10-26 | main | fail | pocs/crate (1 stmt) | pocs/crate: likely real: no migration | 26 files |
| #2373 | 2026-10-24 | main | fail | none (pre-existing drift only) | — | 14 files |
| #2312 | 2026-10-19 | main | fail | none (pre-existing drift only) | — | 80 files |
| #2310 | 2026-10-19 | main | fail | none (pre-existing drift only) | — | 154 files |
| #2306 | 2026-10-19 | main | fail | none (pre-existing drift only) | — | 239 files |
| #2284 | 2026-10-16 | main | fail | none (pre-existing drift only) | — | 389 files |
| #2283 | 2026-10-16 | main | fail | none (pre-existing drift only) | — | 154 files |

## Not measured

- #1388 — not measurable — every target was legacy (skipped)
- #1331 — not measurable — every target was legacy (skipped)
- #1243 — not measurable — every target was legacy (skipped)
- #775 — not measurable — every target was legacy (skipped)
- #717 — not measurable — every target was legacy (skipped)
- #354 — not measurable — no deployed app with db:generate
- #185 — not measurable — no deployed app with db:generate
- #183 — not measurable — no deployed app with db:generate

**Totals** (roll-ups not double counted): guard fired on 15 · real misses 7 · false alarms 2 · pre-existing-drift-only 11.

## Checked by eye

- **#2726 kassa** (`ALTER TABLE sales_sync_status ADD team_id`) — **real**, the known case; the guard catches it.
- **#3572 kassa, velo** — **false alarm**: hand-written `0008_/0004_domain_per_team_pending.sql` exist, only the drizzle snapshot is missing. crate, status, gallery — **real**: domain-index change with no migration.
- **#2552 crate, #2850 gallery, #2984 gallery** — "likely real" (no migration file in the PR); not individually opened.
- 11 PRs fire the guard only because of drift already on the parent (the merged guard has no baseline); the PR introduced nothing.
- Caveat: tested at the merge commit and its first parent, not the PR head.
