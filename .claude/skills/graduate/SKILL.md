---
name: graduate
description: Turn a proven POC into a real, test-first, documented package (or packages) plus a consuming app — the deliberate "step back and rebuild" checkpoint after heavy POC iteration. Starts with a handoff brief (what it does · features · gotchas), then rebuilds test-first (the #774 gate), emits app + package(s), documents, and promotes. Use when a `pocs/*` app is proven and "done", or when asked to "graduate this poc", "make it a real app", "extract the package", "turn the spike into a package".
allowed-tools: Read, Grep, Glob, Bash, mcp__github__issue_read, mcp__github__issue_write, mcp__github__sub_issue_write, mcp__github__add_issue_comment, mcp__github__list_issues, mcp__github__search_issues, mcp__github__get_label
---

# Graduate — turn a proven POC into real, test-first packages + an app

A POC (`pocs/*`) is an **incubator**: messy, churny, safe-to-fail code built to
*learn the right shape* against a real use case (`pocs/CLAUDE.md`). Graduation is
the deliberate moment we **throw the scaffolding away and rebuild clean** from what
we learned. The output is **an app AND one or more packages** — the app is the
proving consumer, the **packages are the durable value** (sometimes opinionated /
crouton-shaped, sometimes broadly reusable for the Nuxt / Nuxt UI ecosystem). *Once
the app is done right, the package is done right too.*

> **Why this is the test-first moment.** The usual objection to TDD — "we don't yet
> know what it should do" — is gone: the POC *proved* the behaviour. So the proven
> behaviours become the **test spec**, and we build to green. The #774 Test Sign-Off
> gate is *off* in `pocs/*` and *on* in `packages/*` precisely so it fires here.

This skill does **not** auto-merge or auto-deploy. It produces the brief, the
issue tree, the test-first plan, and drives the rebuild under the existing gates.

## When to run

- A `pocs/<name>` app is proven and the owner calls it "done" (the API has settled,
  the pattern is worth reusing).
- The branch has iterated a lot (many `spike-*` builds) and the code has accreted —
  the worst outcome would be copying it into `apps/`.

If the POC is still being explored, it's **too early** — say so and stop.

## The flow

### 1. Handoff brief (the spec the rebuild reads cold)

Before any rebuild, write the brief — the artifact a *fresh session/agent* needs to
understand the POC without re-deriving it from `spike-a … spike-z`. This **extends
`/postmortem`** (run that first if the epic is closing). Capture:

- **What it does** — one paragraph, plain language.
- **The features** — the proven behaviours, as a checklist (each becomes ≥1 test).
- **Watch out for** — the gotchas, dead-ends, and "looks done but isn't" traps found
  while iterating (e.g. timing races, mobile-only bugs, framework quirks).
- **The shape call** — which behaviours are reusable (→ `packages/*`) vs app-specific
  (→ the app), and for each package whether it's *opinionated* or *ecosystem-grade*.

Write it to `writeups/briefings/<name>-graduation-brief.md` and link it on the epic.
**This brief is the single source of truth for steps 2–5** — don't re-read the spike.

### 2. Open the graduation epic

Per `github-tasks`: an **epic** + a **sub-issue per extracted package and the app**
(hypothesis-framed). Label each by its target package/app. The POC's epic is the
*input*; this new epic is the *output*. Reference the brief.

### 3. Rebuild test-first (per extracted unit)

For each `packages/*` unit in the brief:

1. **Write the failing test(s) first** from the feature checklist → `/test-review`
   (the #774 gate) to sign off on the behaviour. The agreed test is the contract.
2. **Build to green** — a clean implementation, **re-derived** from the POC, not
   ported. Resist copy-pasting `spike-*` files; the brief + tests are the spec.
3. Respect the package boundary (the `packages/` edit gate), `pnpm typecheck`, and
   the data-model / UI gates where they apply (`/schema-review` #314, `/ui-proposal`
   #307).

### 4. Document as you go

Each new/changed package gets a real `CLAUDE.md` (Purpose · Key Files · Conventions)
— the AI-docs discipline the POC deliberately skipped. New package ⇒ also
`node scripts/gen-package-catalog.mjs` and a `pkg:*` label.

### 5. Promote + deploy

Promote `pocs/<name>` → `apps/<name>` (or scaffold a fresh app) — it now takes on the
`apps/` rules, the `app:*` label, full CI / two-domain deploy. Use `/deploy`. The POC
can then be retired (`/remove-app`) once the app supersedes it.

## What you hand back

- `writeups/briefings/<name>-graduation-brief.md` (what · features · gotchas · shape).
- A graduation epic + sub-issues (one per package + the app).
- A test-first plan: the feature checklist mapped to signed-off tests.
- The promotion path (which packages, which app).

## Conventions

Defers to the **root `CLAUDE.md`** for all workflow/commit/issue conventions
(ISSUE-FIRST, `/commit`, no-squash merges, the `packages/` edit gate, test-first
#774). Reuses `/postmortem`, `/test-review`, `/schema-review`, `/ui-proposal`,
`/deploy`, `/remove-app`. This skill is the *orchestration* of that graduation
checkpoint — it doesn't replace any of them.
