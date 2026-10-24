# @fyit/canary-target

**This is not a real package.** It is the `packages/`-side crash-test dummy for the worker-pipeline
canary rig (#1878) — the sibling of `pocs/canary`. Nothing here is used by anything, and nothing
here is worth protecting.

If you found this because a tool flagged it as unused, dead, or undocumented: that is expected.
Check [`.github/canaries.json`](../../.github/canaries.json) before changing anything.

> **Do not import it. Do not publish it. Do not add real features to it.**
> `private: true` and no `exports` field, so it can never be published by accident.

## Why a whole package exists for this

Exactly one canary needs it: **`packages-logic-needs-test`**, the guard for #1885.

That canary checks that a hand-written `packages/` logic change ships **with its test**. The gate it
exercises — `planTestsGate` in [`scripts/pi-finish.mjs`](../../scripts/pi-finish.mjs) — keys on:

```
^packages/[^/]+/.*\.(ts|mjs|js)$
```

A path under `pocs/` matches nothing there, so `pocs/canary` cannot reach this gate no matter how it
is shaped. The canary either targets a **disposable** package or it targets **real shared code** —
and pointing repeated agent runs at real shared code is the thing the `packages/` hard gate exists
to prevent. Hence this folder.

## Why #1885 is worth a package

The pipeline shipped #1875's logic with **none of its five agreed test cases**, and every check went
green: acceptance said "not verified", CI passed (a missing test breaks no build), and the PR was
mergeable. The omission was invisible. Contract clause (7) now requires the test; this canary is
what proves the requirement is actually enforced rather than merely written down.

## The shape a canary run must reproduce

| Path | Role |
|---|---|
| `src/index.ts` | one small **pure** function (`clamp`) — the reference for "hand-written packages/ logic" |
| `test/clamp.test.ts` | its test — the reference for "and its test" |

A canary run is asked to add a second function *and* its test. If the worker ships the logic alone,
the tests gate holds the PR as a draft and says `tests: MISSING` — which is the canary failing, and
exactly the regression it is there to catch.

## Interactions worth knowing

- **`packages-guard`** (PR-time, #1611) requires a `packages/**` PR to *declare* the edit. The
  canary's own issue carries a `pkg:canary-target` label, which satisfies the linked-issue signal —
  no carve-out in `scripts/packages-guard.mjs` was needed.

  **The label alone is not enough: the PR body must actually reference the issue.** The guard
  resolves linked issues by matching `Closes|Fixes|Resolves|Refs #NN` **in the PR body**
  (`.github/workflows/packages-guard.yml`) — a bare `#NN` mentioned in prose links nothing and the
  check fails with *"no declared approval"*. A worker PR carries `Closes #NN` by convention, so a
  canary run satisfies this on its own. A hand-written PR touching this package must add `Refs #NN`
  (links without closing — canary issues must stay open) or a `Packages-approved:` body line.
  Learned the hard way: the PR introducing this package failed the guard for exactly this reason.
- **Never merged.** `mode=dispatch` closes the previous canary PR and deletes its branch, so a
  worker's edits here are thrown away. `main` should always show just `clamp` and its test.
- **Not in the changesets fixed group.** Named `@fyit/canary-target`, not `@fyit/crouton-*`, so it
  sits outside the `fixed: [["@fyit/crouton-*"]]` version group. `private: true` also means
  changesets ignores it (`privatePackages.version: false`).

## Commands

```bash
pnpm --filter @fyit/canary-target test        # vitest
pnpm --filter @fyit/canary-target typecheck   # tsc --noEmit
```

Workflow, commit, and issue conventions: see the root [`CLAUDE.md`](../../CLAUDE.md).
