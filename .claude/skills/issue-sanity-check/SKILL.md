---
name: issue-sanity-check
layer: method
description: A pessimistic go/no-go the moment you pick up a GitHub issue — read it skeptically and hunt for reasons NOT to do it (already done? obsolete? duplicate? premise wrong? cheaper way? net-negative?), returning proceed / reshape / drop with one-line evidence. The pickup-time half of the dedup gate (the create-time half is /issue-dedup). Use as step 1 of the Task Execution Workflow, or run /issue-sanity-check #NN.
allowed-tools: mcp__github__issue_read, mcp__github__search_issues, mcp__github__list_issues, mcp__github__add_issue_comment, Read, Grep, Glob, Bash
---

# Issue Sanity-Check — should this even be done? (pickup gate)

Claiming an issue and starting to build is a reflex. This skill inserts a **deliberately
skeptical pause** first: a stale, obsolete, duplicated, or wrong-premise issue is cheapest to
catch *before* a build is sunk into it. It's the **pickup-time** half of the dedup gate;
**`/issue-dedup`** is the create-time half. Both are sub-issues of epic #297.

This is a **skeptic's checklist, not a rubber stamp.** Your job here is to find a reason *not*
to do the work. If you can't find one, that's the proceed signal.

## When this fires

Step 1 of the Task Execution Workflow — the moment you claim an issue, before doing the
work. Also on demand: `/issue-sanity-check #NN`.

## The checklist (hunt for a reason to STOP)

Read the issue, then ask each — answer with one line of evidence (a link, a path, a date):

1. **Already done?** — search closed issues/PRs and the code for the change. Did a later
   commit/PR already ship this? (`git log --oneline -S'<symbol>'`, `search_issues state:closed`.)
2. **Obsolete / overtaken?** — has the architecture moved past it? (e.g. it targets Pages but
   we're on Workers; it patches a file that's been deleted/rewritten.)
3. **Duplicate / colliding?** — is there an open issue or epic for the same thing? (Reuse the
   `/issue-dedup` search. If yes, this is a merge, not two builds.)
4. **Premise still true?** — does the "we think that…" hypothesis still hold, or did reality
   change? A wrong premise makes a perfectly-built feature worthless.
5. **Cheaper alternative?** — is there a smaller change, an existing composable/skill, or a
   config flip that gets 90% of the value? (KISS — CLAUDE.md core principle.)
6. **Net-negative?** — does it add surface/complexity we'll regret, contradict a current
   pattern, or block something more valuable? Sometimes the right move is to close it.

## The verdict (REQUIRED output)

End with exactly one of:

- **✅ Proceed** — no blocker found. One line on why it still makes sense, then go.
- **🔁 Reshape** — the goal is valid but the framing/scope is wrong. State the smaller/changed
  scope, update the issue body, then proceed on the reshaped version.
- **🛑 Drop** — there's a real reason not to do it. Name it with evidence, and (interactive)
  recommend closing `not_planned` / merging into the duplicate — **ask the owner before
  closing**, don't unilaterally bin their issue.

Keep it tight — six one-line checks and a verdict, not an essay. The value is the *pause*, not
a long report.

## Recording it

- **Interactive** → state the verdict in chat. For 🔁/🛑, ask the owner before reshaping or
  closing (use `AskUserQuestion`). For a 🛑 you act on, post a comment with the evidence so the
  close is explained (lead with the 🤖 provenance header — see CLAUDE.md).
- **Autonomous / pipeline** → post the verdict as a comment on the issue (provenance header)
  so the chain is auditable, and for 🛑 set `status:blocked` + @mention rather than closing
  silently.

## What this is not

- Not the create gate — that's `/issue-dedup` (don't mint a duplicate).
- Not bug-archaeology — that's the "how/when was this introduced" gate for *bugs* (#424).
- Not a license to skip work you simply don't feel like doing — the verdict needs *evidence*,
  not vibes.
