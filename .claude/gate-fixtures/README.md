# Gate smoke fixtures (#1035)

**Throwaway, committed known-bad fixtures** — one per agent gate
(`frontend-review`, `a11y`, `red-team`) — that each gate's checklist is
guaranteed to flag 🔴. They exist to answer the #834 postmortem's headline
lesson: a gate verified only "clean → green" is indistinguishable from a gate
that enforces nothing. These turn that "bad → red" check into something
committed and re-runnable instead of an ad-hoc one-off PR (the #847 smoke).

## Why these live here, not as a real PR

A fixture-in-a-PR smoke (like #847) is expensive to repeat — open a PR, wait
for the gate, tear it down. Instead the fixtures are committed once, **diff-
scope-excluded** from the real per-PR gates (see below), and exercised
on-demand by `.github/workflows/gate-smoke.yml` (`workflow_dispatch`), which
points each gate's subagent directly at its fixture instead of a PR diff.

## Diff-scope exclusion (so these never self-flag ordinary PRs)

Each real gate workflow (`frontend-review.yml`, `a11y.yml`, `red-team.yml`)
excludes this directory from its `paths` trigger with a leading `!` entry —
`'!.claude/gate-fixtures/**'` — so committing/touching a fixture does not
itself trigger the real per-PR gate. The **smoke** workflow scans the fixture
directly (not via `git diff`), so exclusion from the trigger doesn't blind it.

## Fixtures

| Gate | Fixture | Violation | Expected verdict |
|------|---------|-----------|-------------------|
| `frontend-review` | `frontend-review/SmokeDropdown.vue` | v3 component name `<UDropdown>` (v4 is `<UDropdownMenu>`) — the #847 fixture, formalized | `critical` |
| `a11y` | `a11y/SmokeIconButton.vue` | icon-only interactive control with no accessible name, no keyboard handler, no semantic role | `critical` |
| `red-team` | `red-team/smoke-unscoped-handler.ts` | a team-scoped-looking handler that reads a router param and queries by it directly, with **no** `resolveTeamAndCheckMembership` / auth check at all — a cross-team IDOR | `critical`/`high` |

## Running the smoke

- **CI (preferred):** Actions → **"Gate Smoke (known-bad fixtures)"** → *Run
  workflow* → pick a gate (or `all`). Green means every selected gate's
  meta-check passed (i.e. the gate actually turned red on its bad fixture).
  A **red** smoke run means a gate failed to flag its own known-bad fixture —
  treat that as a fail-open regression (exactly the #834 class of bug) and
  block merges on the affected gate until fixed.
- **Local:** `bash scripts/gate-smoke.sh <frontend-review|a11y|red-team|all>`
  — same fixtures/expectations, useful for a quick sanity check without
  round-tripping through Actions (it shells out to the same claude-code CLI
  invocation the workflow uses; requires `ANTHROPIC_API_KEY` in the
  environment).

## Proving the smoke actually guards the fail-open case (#1035 acceptance)

Per the issue's `## 🧪 Verify`: temporarily regress the #1031/#1033
permission-grant fix (drop `--allowedTools` from one gate's
`claude_args`) and re-run that gate's smoke — it must go from green to
**red**, because the un-allowlisted agent can compute the verdict but can't
persist it, and the smoke step should treat "the fixture wasn't clearly
flagged" as a failure, not a silent pass. Do this by hand when validating a
change to the permission grant; it is not run automatically on every PR
(that would require deliberately breaking a gate in CI).
