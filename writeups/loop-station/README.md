# Loop Station — committed inventory data

This folder holds the **committed** output of the Loop Station context-budget
inventory (WS1 of epic #926, sub-issue #927).

## `history.jsonl`

One JSON record per relevant merge — appended by
`.claude/skills/loop-station/append-history.mjs`, produced by `gather.mjs`. It is
**committed on purpose**: the volume is tiny (~one short line per merge that
touches the harness), and keeping it in-repo means the metric travels with the
code it measures and stays `git blame`-able. The runtime *trace* (WS2) is the
only Loop Station dataset that is gitignored — not this.

Each record (see `gather.mjs` for the exact shape):

| field | meaning |
|-------|---------|
| `generatedAt` / `commit` / `pr` | when, and the merge/PR that caused the point |
| `tokenizer` | `anthropic` (count_tokens) or `heuristic` (offline fallback) — **don't compare a trend across two tokenizers** |
| `totals.alwaysOnTokens` | root `CLAUDE.md` token weight (the always-on budget) |
| `totals.tokens` / `byKind` | all measured artifacts, split by claudemd/skill/agent |
| `scorecard` | green/amber/red bands for length / redundancy / drift-risk (formulas, not LLM) |
| `redundancy` | corpus shingle redundancy %, per-file self-redundancy, top restated pairs |
| `coldWrites` | per-CI-workflow cold-write totals (always-on + prompt) for each LLM workflow |
| `artifacts` | per-file tokens / bytes / lines |

The **first line is a heuristic-tagged seed** (generated without an API key); the
first CI run on a relevant merge writes the first `anthropic`-tagged point.

## Regenerate by hand

```bash
# print a record (uses count_tokens if ANTHROPIC_API_KEY is set, else heuristic)
node .claude/skills/loop-station/gather.mjs --pretty

# append it to history.jsonl (idempotent per commit)
node .claude/skills/loop-station/gather.mjs | node .claude/skills/loop-station/append-history.mjs
```

## `findings.jsonl` — the accountability scoreboard (#1570)

One JSON record per **defect a review gate raised against an authored change**. This
is the reviewer-vs-author side of the eval ledger: every *confirmed* defect is a
severity-weighted, zero-sum-ish transaction — **−w to the author flow, +w to the gate
that caught it** — while a clean merge earns its author +1 (from the run-outcome
ledger). Committed for the same reason as `history.jsonl`: tiny volume, and the metric
travels with the code it measures. Names + refs + severity only — **no payloads**.

| field | meaning |
|-------|---------|
| `gate` | the reviewing gate/skill that raised it (`code-review`, `red-team`, …) — or the later catcher for an escaped defect (`human-revert`) |
| `severity` | `critical`/`high`/`medium`/`low` → weight `5/3/2/1` (tune in `findings-schema.mjs`) |
| `author_ref` / `author_flow` | the introducing run's ledger `ref` (join key) + its flow — who takes the −w |
| `status` | `pending` (scores nothing yet) · `confirmed` (real defect, scores) · `rejected` (false positive → gate −w) |
| `escaped` | `false` = caught in review · `true` = shipped, caught later (author penalty ×2, plus `missed_gate` −w) |
| `confirmed_via` | how it was confirmed: `fix-merged` / `reverted` / `lgtm` / `incident` |

The **first line is a real datapoint** (the #862 escaped-defect revert); the two
`SEED-*` lines demo the first-slice `code-review` gate and are replaced as real CI
findings land.

```bash
# append a finding
node scripts/eval-ledger/append-finding.mjs --gate code-review --severity high \
  --status confirmed --confirmed_via fix-merged --author_flow task-worker \
  --author_ref https://github.com/.../pull/123

# render the two leaderboards (markdown / --json / --html)
node scripts/eval-ledger/accountability.mjs
```
