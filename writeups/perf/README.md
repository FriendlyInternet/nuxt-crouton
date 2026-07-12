# App performance budgets — committed trend data

Committed output of the **bundle-size budget** (#1581) — the deterministic,
product-facing sibling of the Loop Station harness-size inventory. Same producer
shape (deterministic measurement → committed JSONL → threshold bands), pointed at
the built **app bundles** instead of the harness context.

## `bundle-history.jsonl`

One JSON record per (app, merge), appended by `scripts/perf/append-bundle-history.mjs`
(produced by `scripts/perf/bundle-size.mjs`). Committed on purpose: tiny volume, and
the metric travels with the code it measures (`git blame`-able). Written only by the
main-context `bundle-budget.yml` job — never from a PR branch.

| field | meaning |
|-------|---------|
| `generatedAt` / `commit` / `pr` | when + the merge/PR that caused the point |
| `app` | the app measured (e.g. `velo`) |
| `totalJs` / `gzipJs` · `totalCss` / `gzipCss` | raw + gzipped bytes by asset type |
| `totalGzip` | **the budget number** — total gzipped JS+CSS the client downloads |
| `chunks` | top chunks by gzipped size (`name`, `bytes`, `gzip`) |
| `scorecard` | `size` band (absolute gzip weight) + `regression` band (% vs the previous point); `overall` = the worse |

Bands are tuned in `scripts/perf/scorecard.mjs` (the one place). It's **deterministic**
— same build → same bytes — which is exactly why it can be a budget, unlike Lighthouse
vitals (those stay report-only in `unlighthouse.yml`).

## Regenerate by hand

```bash
# after building an app (NITRO_PRESET=cloudflare_module nuxt build):
node scripts/perf/bundle-size.mjs --app velo --dir apps/velo/.output/public/_nuxt --pretty

# append a point (idempotent per app+commit):
node scripts/perf/bundle-size.mjs --app velo --dir apps/velo/.output/public/_nuxt --commit "$SHA" \
  | node scripts/perf/append-bundle-history.mjs
```

CI: `.github/workflows/bundle-budget.yml` (weekly + `workflow_dispatch`) builds the
launched apps, measures, and commits new points.
