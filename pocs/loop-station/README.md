# Loop Station — the observatory view (WS3)

The read-only viewer for the Loop Station observatory (epic #926, sub-issue #931).
It **only renders** — all compute lives in the WS1/WS2 scripts under
`.claude/skills/loop-station/`. This app stages their output and draws it.

## What it shows

- **Context budget · CLAUDE.md** — always-on token trend per merge (`nuxt-charts` LineChart).
- **Scorecard** — length / redundancy / drift-risk bands as KO LEDs (green/amber/red).
- **Loop graph** — the observed call topology via `@vue-flow/core` + `@dagrejs/dagre`
  auto-layout (node ∝ invocations, ⟲ = recursion).
- **Inventory · size × usage** — dead-weight detector (big skill × zero invocations).
- **CI cold-write** — per-LLM-workflow always-on + prompt totals.
- **Trace** — depth-indented event timeline with sub-agent durations.

## Stack (ecosystem reuse, no crouton-core)

A standalone Nuxt app — **no DB, no auth, no crouton-core** (it's a static viewer):

- **`@fyit/crouton-themes/ko`** — the hardware (Teenage-Engineering) theme, so the
  observatory reads like a physical instrument (`KoPanel`, `KoLed`, `KoDisplay`).
- **`nuxt-charts`** — the charting module `crouton-charts` wraps; used directly
  here since there's no collection to bind to.
- **`@vue-flow/core` + `@dagrejs/dagre`** — the graph stack `crouton-flow` wraps;
  used directly because we render a fixed trace, not an editable multiplayer graph.

> We deliberately avoid the `crouton-flow` / `crouton-charts` *wrappers* — they
> extend `crouton-core` (collections, auth, collab) for *authoring* collection
> data. The observatory only *observes*, so it adopts the underlying libraries.

## Data seam

`scripts/prepare-data.mjs` runs before `dev`/`build` and stages into `public/data/`:

- `history.jsonl` ← the committed WS1 inventory (`writeups/loop-station/history.jsonl`).
- `trace.jsonl` ← WS2: reconstructed from local transcripts if present (real data),
  else the committed `data/example-trace.jsonl` (a real captured trace).
- `usage.jsonl` ← the committed WS-A cross-run usage rollup
  (`writeups/loop-station/usage.jsonl`, #1064) when it exists — preferred over the
  loaded trace for the dead-weight join. Empty until the weekly job lands.
- `sources.json` ← the provenance manifest (#1065): which source each dataset came
  from. The size×usage panel labels itself with it — **only** the CI rollup may
  render a dead-weight verdict; a local session shows counts without verdicts;
  sample data shows size only.

`public/data/` is gitignored (build artifact); the sources of truth are committed.

## Run

```bash
pnpm --filter loop-station dev        # http://localhost:3021
pnpm --filter loop-station build
pnpm --filter loop-station cf:staging # via /poc-deploy for a staging URL
```

## Handoff — compose this with the layout builder (future direction)

This dashboard is a **prime candidate for the crouton layout builder.** The page
is deliberately built from independent, self-contained panels — `BudgetTrend`,
`Scorecard`, `LoopGraph`, `InventoryTable`, `TraceTimeline`, and the cold-write
bars — currently arranged by hand in `app/pages/index.vue`.

The next iteration should **register these panels as placeable layout blocks**
(`croutonLayoutBlocks`, see the `block-authoring` skill) and let the **layout
builder** compose the dashboard into a `layout_configs` tree, instead of a
hardcoded page. Each panel already sizes to its container, so the main work is
the block registration + sizing contract, not a rewrite.

**Intended authoring flow (the nesting model).** The builder composes *bottom-up
and recursively* — pair panels into a small layout, pair layouts into a bigger
one, and so on:

1. Click a **graph** + a **list** together → that pair becomes **layout A**.
2. Click another **graph** + **list** together → **layout B**.
3. Click **A + B** together → a larger composed layout.
4. Under that, drop the **Vue Flow loop graph**, then the next block… and so on.

So a "layout" is itself a placeable unit (a node in the `layout_configs` tree),
and bigger layouts are layouts-of-layouts — exactly the recursive container tree
the layout engine already models. The Loop Station's six panels are a clean first
real test case for that compose-and-nest interaction.

> Note the boundary: this is the **layout** builder arranging *view panels* — not
> a loop builder. Epic #926's "observatory, not a loop builder" line still holds;
> composing the observatory's own panels is a presentation concern.
