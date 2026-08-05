# Golden-task eval set — WS6b.3 (#885)

Part of the model-routing evidence loop (WS6b, #865; epic #669). The scoreboard
(`scripts/eval-ledger/scoreboard.mjs`) tells you which model is winning on **real**
flows; this is the **safe probe you run before that** — three representative,
throwaway-issue-shaped tasks with **deterministic** pass criteria, scored on
**fixtures, never `main`** (the #670 spike lesson).

## The 3 tasks (`tasks.mjs`)

| id | category | what a candidate model is asked to do | deterministic check |
|---|---|---|---|
| `reports-only` | reports-only | write an a11y report for `fixtures/minimal` to a fixed path, using the report template's required sections | the file exists and has `# `, `## Summary`, `## Findings` |
| `small-crud` | small-crud | add a field to a fixture collection, regenerate, keep the e2e smoke green | the fixture's Playwright JSON report has 0 failed / ≥1 passed spec |
| `scaffold` | scaffold | `crouton init` a throwaway single-collection POC | the scaffold dir has `package.json` + `crouton.config.js` + `nuxt.config.ts` |

Each task's `check(ctx)` is pure and dependency-free — no LLM judge, same
gather→verify discipline as the rest of the eval-ledger tooling.

## Running the loop

1. **Work the task.** Give the candidate model the task's `promptSummary` (e.g. via
   a `delegate-pi` run pointed at a throwaway issue) against a **fixture / scratch
   path** — never `main`.
2. **Score it** — point `run.mjs` at whatever artifact the task produced:

   ```bash
   # reports-only
   node scripts/eval-golden/run.mjs --task reports-only \
     --report-path writeups/reports/golden-reports-only.md \
     --model anthropic/claude-haiku-4-5 --harness pi

   # small-crud (after `pnpm test:e2e` against fixtures/minimal, --reporter=json)
   node scripts/eval-golden/run.mjs --task small-crud \
     --playwright-report playwright-report/report.json \
     --model ollama/qwen2.5-coder --harness pi

   # scaffold
   node scripts/eval-golden/run.mjs --task scaffold \
     --scaffold-dir /tmp/golden-scaffold \
     --model anthropic/claude-haiku-4-5 --harness pi
   ```

3. **Read the result.** `run.mjs` prints `PASS`/`FAIL` + reason, and (unless
   `--dry-run`) appends a row to the WS6b.1 ledger tagged `flow: golden-<task>` via
   `scripts/eval-ledger/append.mjs` — so it rolls straight into the WS6b.2
   scoreboard (`node scripts/eval-ledger/scoreboard.mjs`) alongside real-flow rows,
   filterable by the `golden-*` flow prefix.

   `--dry-run` runs the check and prints the verdict without writing to the ledger
   (exit code mirrors the verdict — handy for a CI gate).

## Dispatching on-demand (workflow, human-applied)

Running this against a **candidate model on the mac-mini / a hosted runner** needs a
`workflow_dispatch` entry point. This PR does **not** commit one — the operating
token for this run has no `.github/workflows/**` write scope (#1076 convention) — so
the workflow is embedded verbatim in the PR body under **"Workflow patch (human
applies)"** for `@pmcp` to add.

## Tests

```bash
node scripts/eval-golden/tasks.test.mjs   # 11/11, dependency-free
```

## Notes

- **Never `main`.** Every task targets a fixture (`fixtures/minimal`) or an
  explicit scratch path (`/tmp/...`, a throwaway branch) — the #670 spike is the
  cautionary tale for skipping this.
- The 3 categories map 1:1 to the routing tiers WS6a (`routing.yaml`) cares about
  most: a cheap report-only flow, a mid CRUD change, and a heavier scaffold —
  so a candidate model's golden-task results are a reasonable predictor of its
  real-flow tier.
