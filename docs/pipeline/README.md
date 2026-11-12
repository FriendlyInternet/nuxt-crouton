# Pipeline v1 — a plain guide

> **New here?** Start with [How a ticket becomes a merged change](./how-it-works.md). This page covers only pipeline v1 merging.

> **Read this first:** this guide is part of [#3458 — pipeline versions](https://github.com/FriendlyInternet/nuxt-crouton/issues/3458).

## What it is

Pipeline v1 is an opt-in setting **per epic**. Put the `pipeline:v1` label on the epic
**before** it is split into sub-issues. The label is read once, when the epic branch is
created; adding it later does nothing.

## What changes

| Pull request | What happens |
| --- | --- |
| Leaf → v1 epic branch | GitHub auto-merges it once `CI Gate` and `Merge decision` are both green |
| Epic → `main` | Unchanged: needs the owner's `ok` |
| Leaf → `main` | Needs the owner's `ok`, unless every changed file is in the incubator stage and the build review said go on the current commit — then it merges once green (#3757) |

Holds still hold: a failing check, a draft sign-off PR, a missing review, or changes to
`packages/` or workflow files keep `Merge decision` waiting, so GitHub does not merge.
The owner's own PRs into a v1 branch get a passing `Merge decision` but are merged by hand.

## Branch name

`epic/<n>--v1-<slug>`, for example `epic/3545--v1-test-epic`. The doubled `--` cannot
appear in a branch made the normal way, so it marks a v1 epic.

## The ruleset

- Name: `pipeline-v1`
- Applies to: `refs/heads/epic/*--v1-*`
- Requires `CI Gate` (GitHub Actions, integration 15368) and `Merge decision`
  (Nuxt Harness App, integration 4107840)
- Merge commits only
- The Harness App may bypass it. It pushes straight to epic branches (sync with main,
  sign-off images, conflict resolver) and, in one fallback, merges a PR that GitHub
  refuses to auto-merge because it is already mergeable.

Full definition: [`ruleset-pipeline-v1.json`](./ruleset-pipeline-v1.json).

## Turn it off

v1 is on unless the repo variable `PIPELINE_V1` is `off` (case and spaces ignored).

1. Settings → Secrets and variables → Actions → Variables: set `PIPELINE_V1` to `off`.
2. Actions → "Auto-merge epic sub-PRs" → Run workflow, leave `pr` empty. This turns
   auto-merge off on every open v1 PR.
3. Settings → Rules → Rulesets → `pipeline-v1` → set Enforcement to **Disabled**.

Order matters: if the ruleset goes off while auto-merge is still on, the PRs have no
required checks left and GitHub could merge them straight away.

(The `trial-3501-v1` ruleset only targets `refs/heads/trial/v1-base`; it is not the off switch.)

## Turn it back on

Reverse order: re-enable the `pipeline-v1` ruleset **first**, then delete the
`PIPELINE_V1` variable or set it to anything but `off`.

## Hand-made epics

Epics made with `scripts/epic-scaffold.mjs` ignore `pipeline:v1` (it prints a warning)
and stay on today's path.

## Links

- Epic: https://github.com/FriendlyInternet/nuxt-crouton/issues/3458
- Trial: https://github.com/FriendlyInternet/nuxt-crouton/issues/3501
- Code: `.github/workflows/automerge-epic-subpr.yml`, `scripts/lib/v1-merge-io.mjs`
