# Eval ledger — run-outcome capture + scoreboard (WS6b · #865)

The feedback loop that makes `routing.json` (#864) **evidence-based**: every agent run appends
one objective record; the scoreboard rolls those up into **cost-per-success per (model × flow)** —
the table a human reads to decide "is this cheap model good enough for this flow?".

This is leaf **WS6b.1** (#883, the ledger) + a starter of **WS6b.2** (#884, the scoreboard).
Golden-task eval is **WS6b.3** (#885). Parent: #865, epic #669.

## Why a committed JSONL ledger (not PostHog) for leaf #1

The signals are produced in CI; the metric is reviewed by a human; the routing decision is a
`routing.json` diff. A **committed, append-only JSONL** is therefore the right first sink: diffable,
reviewable, secret-free, no key in CI, and it mirrors the deterministic `epic-digest`/`housekeeping`
gather→render pattern (no LLM). PostHog (where the cost counter already lands) stays an option for a
higher-volume sink later — it's just not reviewable/diffable, which is what leaf #1 needs.

## Files

| File | Role |
|---|---|
| `schema.mjs` | record shape + `validate()` + scoring helpers (`isSuccess`/`isRevert`/`parseLedger`) |
| `append.mjs` | validate + append ONE record (the capture entry point a flow calls) |
| `from-pi-session.mjs` | roll a pi.dev **session jsonl** into one record (reads #938's native `usage`/`cost` feed) → pipe to `append.mjs` |
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

**`model` is the provider-qualified id** — `provider/model`, e.g. `anthropic/claude-haiku-4-5-20251001`
(the form the live pipeline emits). `validate()` trims + lowercases it so the same model logged two
ways aggregates, but the **provider is preserved on purpose**: this is a *cost* scoreboard, so a
hosted `anthropic/…` (~$5/Mtok) must stay distinct from a local `ollama/…` (~$0). `append.mjs` warns
(non-fatal) if a record's `model` has no provider prefix.

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
node scripts/eval-ledger/scoreboard.mjs --html     # standalone HTML view
```

## Periodic scoreboard post (retired, #2892)

The weekly `eval-scoreboard.yml` job that posted this scoreboard to a standing issue was
deleted: the ledger's last row is from July 2026 and nothing read the post. Render on demand
with the commands above.

## Capturing a pi.dev run (#1203)

pi already writes per-turn `usage`/`cost` to its session jsonl (#938 —
`writeups/architecture/pi-telemetry-feed.md`), so a run needs no new instrumentation — just roll
the session up and append:

```bash
node scripts/eval-ledger/from-pi-session.mjs --latest \
  --flow a11y-reports --outcome report --ref <run-url> \
| node scripts/eval-ledger/append.mjs --stdin
```

`from-pi-session.mjs` sums `message.usage.cost.total` (anthropic-provider turns — `pi-claude-cli`
usage is unreliable, #938), counts assistant turns, derives `wall_s` from the message timestamps,
and provider-qualifies the model. It runs where the session file lives (the mac-mini box).

## Wiring into flows (follow-ups)

- **Reports-only pi.dev a11y (#867/#869)** is the first capture site — start here, it's safe (a
  bad model can't hurt `main`). Feed it with `from-pi-session.mjs` (#1203) against the run's
  session jsonl; a real datapoint (2026-07-07 a11y-pidev, $0.365) is already seeded.
- **task-worker / decompose** capture (appending a row from those flows) is the remaining piece —
  the periodic scoreboard post was retired (#2892).
- **Golden-task eval** rows (`flow: golden-*`, on fixtures, never `main`) ship in `scripts/eval-golden/` (#885) — 3 deterministic probes (reports-only / small-crud / scaffold) that append here via the same `append.mjs`.

## Per-run record (#3251) — did this agent run produce anything?

One record per workflow **run** (not per agent session), written by the final `record-outcome` job of
`work-issue-pidev`, `decompose-on-issue-pidev`, `plan-review`, `build-review`, `ticket-review`,
`fix-ci-on-failure` and the interpret chain of `on-comment`. The job `needs:` every other job and
runs with `if: always()`, so failed and cancelled runs are recorded too. A ledger failure never fails
the run (`continue-on-error` + the script always exits 0).

- **Storage:** orphan branch `pipeline-data`, one file per run: `records/<yyyy-mm-dd>/<run_id>-<attempt>.json`
  (contents API; distinct paths cannot conflict, 409/422 retried 3×). Nothing lands on main or epic branches.
- **What counts as output:** an agent-written comment, a review verdict, or a commit on the work branch
  inside the run's window. None → `produced: ["nothing"]` (never skipped).
- **What does not:** the workflow's own notes. Every one carries the hidden marker
  `<!-- pipeline-note -->` at its post site; `scripts/lib/pipeline-note-lint.test.mjs` fails CI for a
  new post site without it (allowlist = verdict comments, the interpreter's own comment, body files that
  start with the marker). Classification is a marker check, never header text.
- **Overlap:** agent comments carry no run id, so two runs of the same workflow on the same issue/PR with
  intersecting windows are `attribution: "shared"` (listing each other in `overlap[]`); a comment that
  embeds `/actions/runs/<id>` is credited exactly to that run. Overlap is computed against records already
  written, so the second run to finish sees the first.
- **API usage:** `api_calls` = `GET /rate_limit` remaining at start minus at end (App token). `null` with
  `api_calls_reason` when the hourly window rolled over (`reset-window-changed`) or a read failed.
  Approximate — concurrent runs share the allowance. The start read is a step inside the agent job; the
  interpret chain of `on-comment` has none, so those rows are `null` / `start-read-failed`.
  `token` is `app` or `github_token`.
- **Stage:** `plan | work | revise` for `work-issue-pidev` (a conflict-resolver run is a revise run),
  otherwise the workflow's own stage name.

| File | Role |
|---|---|
| `record-run.mjs` | build + write the record (thin I/O; exits 0) |
| `gather-runs.mjs` | weekly table: the week's runs joined with records → produced / nothing / shared / unknown / **missing record**, median `api_calls` |
| `backfill.mjs` | one-off `--from 2026-10-22 --to 2026-11-02`; idempotent; `source:"backfill"`, `rule:"legacy"`, `api_calls: null` (`backfill`); unreadable log → `unknown`; `nothing` rows keep the run URL in `ref` |
| `../lib/run-outcome.mjs` | pure rules: `classify`, `joinRuns`, `summarizeRuns` |
| `../lib/rate-limit.mjs` | `readRateLimit` / `diffRateLimit` (shared with the #3287 rate-limit helpers) |
