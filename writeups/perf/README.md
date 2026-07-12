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

Each record carries **two** measured targets — they answer different questions:

| field | meaning |
|-------|---------|
| `generatedAt` / `commit` / `pr` / `app` | when · the causing merge/PR · the app |
| `client` | the **browser** bundle (`public/_nuxt`) → user load speed. `{ totalGzip, totalJs/gzipJs, totalCss/gzipCss, chunks, scorecard }` |
| `server` | the **Worker** bundle → Cloudflare cold-start + CPU → *cost to run*. Same shape, or `null` if not measured |
| `clientGzip` / `serverGzip` / `totalGzip` | convenience rollups (server may be null) |
| `overall` | the worse of the two scorecards |
| `*.scorecard` | per-target `size` band + `regression` band (% vs the previous point); `overall` = the worse |

Bands live in `scripts/perf/scorecard.mjs` — **client** (amber 250 KB / red 500 KB gzip)
and **server** (amber 500 KB / red 1 MB gzip, near Cloudflare's Worker ceiling) differ on
purpose. Deterministic — same build → same bytes — which is why it can be a budget, unlike
Lighthouse vitals (report-only in `unlighthouse.yml`).

> **The server number is the wrangler-BUNDLED Worker, not `.output/server`.** The raw
> `.output/server` tree is the unbundled Nitro output (hundreds of chunks, most tree-shaken
> away at deploy) — measuring it overstates the real Worker by multiples. The workflow bundles
> the true deployed Worker offline with `wrangler deploy --dry-run --outdir` and measures that;
> the engine just measures whatever `--server-dir` it's handed.

## Regenerate by hand

```bash
# after building an app (NITRO_PRESET=cloudflare_module nuxt build):
# client only:
node scripts/perf/bundle-size.mjs --app velo --dir apps/velo/.output/public/_nuxt --pretty

# client + real Worker (bundle it offline first):
( cd apps/velo && npx wrangler deploy --dry-run --outdir=.wrangler-bundle --config .output/server/wrangler.json )
node scripts/perf/bundle-size.mjs --app velo \
  --dir apps/velo/.output/public/_nuxt \
  --server-dir apps/velo/.wrangler-bundle \
  --commit "$SHA" --pretty | node scripts/perf/append-bundle-history.mjs
```

CI: `.github/workflows/bundle-budget.yml` (weekly + `workflow_dispatch`) builds the
launched apps, measures, and commits new points.
