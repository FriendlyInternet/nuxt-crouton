# Eval ledger — run-outcome capture + scoreboard (WS6b · #865)

The feedback loop that makes `routing.yaml` (#864) **evidence-based**: every agent run appends
one objective record; the scoreboard rolls those up into **cost-per-success per (model × flow)** —
the table a human reads to decide "is this cheap model good enough for this flow?".

This is leaf **WS6b.1** (#883, the ledger) + a starter of **WS6b.2** (#884, the scoreboard).
Golden-task eval is **WS6b.3** (#885). Parent: #865, epic #669.

## Why a committed JSONL ledger (not PostHog) for leaf #1

The signals are produced in CI; the metric is reviewed by a human; the routing decision is a
`routing.yaml` diff. A **committed, append-only JSONL** is therefore the right first sink: diffable,
reviewable, secret-free, no key in CI, and it mirrors the deterministic `epic-digest`/`housekeeping`
gather→render pattern (no LLM). PostHog (where the cost counter already lands) stays an option for a
higher-volume sink later — it's just not reviewable/diffable, which is what leaf #1 needs.

## Files

| File | Role |
|---|---|
| `schema.mjs` | record shape + `validate()` + scoring helpers (`isSuccess`/`isRevert`/`parseLedger`) |
| `append.mjs` | validate + append ONE record (the capture entry point a flow calls) |
| `scoreboard.mjs` | read the ledger → per-(model × flow) rollup → Markdown / `--json` |
| `../../writeups/reports/eval-ledger.jsonl` | the append-only ledger (seeded with the #862 revert) |

## Record shape

One JSON object per line:

```jsonc
{
  "ts": "2026-06-22T18:00:00Z",   // ISO-8601 UTC
  "flow": "a11y-reports",          // the workflow/flow
  "skill": "a11y",                 // driving skill (or null)
  "harness": "pi",                 // "claude" | "pi"
  "model": "claude-haiku-4-5-20251001",
  "cost_usd": 0.012,               // null if not captured
  "turns": 8, "wall_s": 142,       // null = n/a
  "artifact_gate": "pass",         // "pass" | "fail" | "na"  (#461)
  "ci": "na",                      // "pass" | "fail" | "na"
  "outcome": "report",             // merged | reverted | abandoned | report | pending
  "human": null,                   // "up" | "down" | null
  "fix_rounds": 0,
  "ref": "https://github.com/.../runs/123",
  "notes": "first pi a11y run"
}
```

**Success** = no gate failed *and* `outcome ∈ {merged, report}` (reports-only flows have no merge,
so a clean report counts). **The routing metric is cost-per-success**, not raw cost or quality.

## Use

```bash
# Append a run (flags map to schema fields; --ts defaults to now):
node scripts/eval-ledger/append.mjs \
  --flow a11y-reports --harness pi --model claude-haiku-4-5-20251001 \
  --skill a11y --wall_s 142 --artifact_gate pass --ci na --outcome report

# Validate without writing (CI / pre-commit):
node scripts/eval-ledger/append.mjs --flow x --harness pi --model m --check

# Or pipe a full object:
echo '{"flow":"x","harness":"pi","model":"m","outcome":"report"}' \
  | node scripts/eval-ledger/append.mjs --stdin

# Render the scoreboard:
node scripts/eval-ledger/scoreboard.mjs            # markdown
node scripts/eval-ledger/scoreboard.mjs --json     # raw rollup
```

## Wiring into flows (follow-ups)

- **Reports-only pi.dev a11y (#867/#869)** is the first capture site — start here, it's safe (a
  bad model can't hurt `main`). Once #869 merges, add an `append.mjs` call in its trusted posting
  step (it already computes `model` / `wall` / `conclusion` for the run summary). Tracked on #883.
- **task-worker / decompose** capture and the periodic scoreboard post (digest/sweep cadence) are
  #884.
- **Golden-task eval** rows (`flow: golden-*`, on fixtures, never `main`) are #885.
