---
name: owner-brief
layer: method
description: Shape every agent comment as a short typed brief the owner can triage in seconds — 🔴 issue · 💡 proposal · ✅ done · 🔀 choice · 🛠 action · 👀 review — with all the depth collapsed behind it. Enforced by the require-owner-brief hook. Use before posting ANY GitHub comment as an agent, or when asked to "make this shorter", "brief me", "just tell me what I need to do".
allowed-tools: Bash, Read, Grep
---

# The owner brief — one line they act on, everything else collapsed

The owner reads these on a phone, holding ~20 async threads. **The depth is not the problem
and is never cut** — the problem is that it arrives *as* the notification, so every ping costs
a full read.

So: **lead with a typed brief, collapse the rest.** Same comment, same content, different order.

## The six types

Pick exactly one. The last three are `ask-human`'s existing shapes — this is one vocabulary,
not a parallel system; reach for that skill's templates when the brief is a hold.

| | type | means | typical follow-up | may @mention? |
|---|---|---|---|---|
| 🔴 | **Issue** | something is broken or wrong | you decide whether it's worth fixing now | yes |
| 💡 | **Proposal** | a suggestion you can take or drop | yes / no / later | yes |
| ✅ | **Done** | landed and verified | nothing | **no** |
| 🔀 | **Choice** | a real fork, needs your pick | `A` / `B` | yes |
| 🛠 | **Action** | you must do something the agent can't | do it, then comment | yes |
| 👀 | **Review** | approve or reject a diff/preview | `ok` / `not ok: …` | yes |

If two apply, pick the one that describes **what you need back**, not what you did. A bug you
already fixed is ✅, not 🔴.

## The other half: don't spend a mention on nothing

**An @mention is a request for action.** Spending one on an FYI teaches the owner to ignore
mentions, which costs far more than the notification. The gate refuses a ✅ carrying a live
mention.

**Where the noise actually came from.** Over the last 100 comments, 29 would notify the owner
and **17 of those carried no ask at all** — their only mention was the mandatory provenance
disclaimer, `posted from @pmcp's account`. It sits in a blockquote, so a reader never sees it,
and GitHub notifies anyway. That was **59% of every ping**.

So the disclaimer now writes the handle in a **code span**:

```
> 🤖 **Claude Code** · interactive agent · posted from `@pmcp`'s account (not Maarten)
```

It renders identically and does not notify. Backticking it across the templates removes those
17 pings; the 12 that remain are genuine asks.

**GitHub notifies for a mention inside a blockquote and inside `<details>`.** Code spans and
fenced blocks are the only places it doesn't. So "hide it in the collapsed section" does *not*
make a mention silent — backtick it, or don't write it.

## The shape

Visible part **≤700 chars and ≤10 non-empty lines**:

```
🔴 **<one line: what happened>**
> 🤖 <provenance header — its own hook requires this>

**You:** <the single next action — or "nothing, FYI">
**Depth:** <link to the full comment / PR / run / report>

<details><summary>Findings / patch / evidence</summary>

…everything you were about to write, at any length…

</details>
```

**`**You:**` is the load-bearing line.** If you can't state one next action, you don't yet know
what you're asking for — work that out before posting.

## Say the visible part plainly (the word-choice layer)

Structure is only half. A brief that is the right shape and still full of repo jargon fails just
as hard — the owner said so, repeatedly: *"i have no idea what you said"*, *"thats unreadable"*,
*"this is gibberish to me"*. The rule is in `AGENTS.md` (*Plain language*); here is what it looks
like, from real messages this session:

| ❌ what was written | ✅ plain |
|---|---|
| "work the second group down — re-dispatch the tasks, verify/close the stale ones — so the filter converges to just the 8 that are genuinely yours" | "8 of these aren't really waiting for you — they got the wrong label. Want me to clean them up? **yes / no**" |
| "the sweep will tag the nine stranded PRs `status:needs-merge` for one-click merging" | "nine finished PRs will show up needing one tap to merge" |
| "#2095 keeps it that way going forward" | *(cut it — the owner doesn't run the plumbing)* |
| "re-dispatch the task to the pipeline" | "hand it back to run again" |

The pattern in every miss: naming the **mechanism** (the sweep, the filter, the label, the issue
number) instead of the **outcome** (what the owner sees or does). Read the visible part aloud as if
to someone who's never seen this repo; any phrase that needs a footnote gets rewritten.

## What doesn't count against the limits

Nothing inside `<details>`, a code fence, the provenance blockquote, an HTML comment marker, or
the generated-by footer. **Collapse it, don't cut it** — if the escape hatch weren't real,
agents would delete content instead of moving it, which is worse than the wall.

A comment with **no 🤖 header** (a human's) is untouched at any length.

## Two failure modes

**Burying the ask.** #2054 posted a patch-to-apply under a question heading, and the gate
announced *"asked you a question"* above 4,372 characters containing no question. The type
marker exists so this can't happen: it says what's wanted before anything else is read.

**Splitting the thread.** Don't post the brief and the depth as two comments — one comment,
brief in front, depth in `<details>`. Two comments doubles the notifications, which is the
problem, not the fix.

## Enforcement

`require-owner-brief` (PreToolUse on `add_issue_comment`) blocks a non-conforming agent
comment and prints the vocabulary + the collapse rule. The decision is
`scripts/owner-brief.mjs` — pure, unit-tested, and checked against the real comment corpus.

**Why the trigger is "is this an agent comment" and not "does it @mention the owner":** the
@mention rule was the obvious design and measuring killed it. Of the 29 owner-mentioning
comments in the last 100, **17 carry `@pmcp` only inside the mandatory provenance disclaimer**
— exactly the long reports being complained about. An @mention gate would have waved the
offenders through and constrained only the dozen that already used a standalone address.

**Why these limits:** across 93 agent comments the visible part runs 0 · 114 · 330 · 591 ·
25497 chars and 0 · 1 · 3 · 6 · 217 lines. The median is already 330 chars / 3 lines; 700c/10L
refuses the walls, not the norm. The line limit reuses the ~10 lines `ask-human` already
states rather than inventing a second number.

## Relationship to `ask-human`

`ask-human` covers the **blocking** subset (🔀 / 🛠 / 👀) in depth: the `Needs:` line, the
recommendation-first rule, the medium-selection table, `status:blocked`, push-before-you-block.
This skill is the wrapper that makes **every** comment — including the non-blocking 🔴 / 💡 / ✅
— arrive in the same scannable shape. When the brief is a hold, use `ask-human`'s template
inside it.

## Plain comments are read (#2980)

An owner comment that matches no command is read by a default-tier model (Sonnet), which picks one safe action (revise, replan, start, review, answer, ask, ignore). Merge, close, delete, deploy and teardown are never done from a plain comment: the reply is "I read this as X. Reply `ok` to confirm." Irreversible actions still need `ok`.

## Hook + provenance detail (moved from root CLAUDE.md, #3350)

**ISSUE-FIRST (HARD GATE): open the tracking issue BEFORE writing code.** For any new feature/package/app/initiative, the *first* action is creating the GitHub issue (epic + sub-issues for anything multi-step) via the `github-tasks` skill — not after the work, not at PR time. If you catch yourself editing files for an initiative that has no issue, STOP and open it first. New package or app? It also needs its `pkg:`/`app:` label in `.github/labels.yml`. This is the step most easily skipped — treat a missing issue like a failing build.

**DEDUP-BEFORE-CREATE (HARD GATE): search for an existing related issue/epic BEFORE opening a new one.** Issue-first's failure mode is the *duplicate* — an ephemeral session opens a second epic for work that's already tracked (the #257/#265 blog case). Before any `issue_write` create, run the **`issue-dedup`** skill: search open **and** recently-closed issues/epics, surface matches, and force a **reuse / replace / new** decision — if a match exists, **reuse it, don't mint a duplicate**. This is enforced: the `require-issue-dedup` PreToolUse hook (`.claude/hooks/`) blocks a `create` whose body lacks a `Dedup-checked:` attestation line. (#297)

Tasks are tracked as **GitHub issues** (`FriendlyInternet/nuxt-crouton`) — see the `github-tasks` skill. The issue is the unit of work: open an **epic + sub-issues** for an initiative, label each by **package or app** (never `root`; exactly one `type:*`). Work lands via a **PR** on a feature branch (commit with `/commit`, reference `(#NN)`, put `Closes #NN` in the PR body to auto-close on merge) — not direct pushes to `main`. `writeups/PROGRESS_TRACKER.md` becomes an optional phase-level rollup, not the per-task tracker.

**Always link issues & PRs when you mention them in chat.** Whenever you reference an issue or PR to the user (in prose, lists, or tables), include its full URL so it's one click to open — `#NN` alone isn't clickable. Format: `#303` → `[#303](https://github.com/FriendlyInternet/nuxt-crouton/issues/303)` for issues, `…/pull/376` for PRs. This is a **chat-reply** convention only — keep bare `(#NN)` in commit messages, and use `Closes #NN` (not a URL) in PR bodies so GitHub's auto-close works.

**Agent-posted GitHub comments LEAD with a 🤖 provenance header.** Pick the header by **who the comment actually posts as** — there are two cases, and the disclaimer differs:

- **Interactive agent** — a comment written via the `add_issue_comment` MCP tool posts under the **@pmcp human account**, so it can be mistaken for Maarten. It MUST disclaim that:
  `> 🤖 **Claude Code** · interactive agent · posted from `@pmcp`'s account (not Maarten) · _<one-line context>_`
- **Autonomous pipeline** — a CI workflow / worker comment posts under an **unmistakable bot account** (`claude[bot]` / `nuxt-harness[bot]`), so the @pmcp disclaimer would be **false** — do NOT add it. Just name the source:
  `> 🤖 **Claude Code** · agent pipeline (CI) · _<one-line context>_`

The auto-appended "Generated by Claude Code" footer is too easy to miss; the 🤖 header is the unmistakable signal. Enforced by the `require-comment-provenance` PreToolUse hook (`.claude/hooks/`), which fires on the interactive `add_issue_comment` path and blocks a comment lacking the `🤖` header. (Applies to comments only — issue/PR *bodies* are already clearly agent-authored work items.)

**…and they LEAD with a typed brief (#2081).** The header says *who*; the brief says *what you need back*. Every agent comment opens with one of **🔴 issue · 💡 proposal · ✅ done · 🔀 choice · 🛠 action · 👀 review**, one `**You:**` line naming the single next action, one `**Depth:**` link — and **everything else collapsed inside `<details>`**. Visible part ≤700 chars / ≤10 lines; nothing inside `<details>`, a code fence, the provenance blockquote or the footer counts, so **the depth is moved, never cut**. Enforced by the `require-owner-brief` PreToolUse hook (decision in the unit-tested `scripts/owner-brief.mjs`); the shape + the six types live in the **`owner-brief`** skill. `ask-human` remains the deep template for the three *blocking* types. **Structure is only half — say the visible part in PLAIN LANGUAGE too** (`AGENTS.md` → *Plain language*, examples in `owner-brief`): no repo jargon, lead with what the owner does or gets (not the mechanism), end an ask with a plain `yes/no` or `A/B`. This applies to **chat replies too**, not only comments — the owner shouldn't have to ask "be concrete" every time.

**A change request for a pipeline worker names it.** An interactive-agent comment on a pipeline-built PR
re-runs the pi worker only when it carries a line starting `**Worker:** <what to change>` (#2453,
`scripts/revise-route.mjs`); every other 🤖-headed comment (status, FYI, the pipeline's own) is ignored by
the revision loop, and a plain human comment is feedback as before.

**And a type that needs nothing back must NOT @mention** — a mention is a request for action, so a ✅ carrying one is refused. Careful: a mention notifies from inside a blockquote **and** from inside `<details>`; only code spans and fenced blocks are exempt. That is why the provenance disclaimer above backticks the handle (`` `@pmcp` ``) — unbackticked it pinged on *every* interactive comment, which was **17 of the last 29 notifications, 59% of all pings, carrying no ask at all**.

**Write issues & epics as hypotheses, not task lists (default).** The 4-part frame is in [`AGENTS.md`](./AGENTS.md) (*Issues → Write as a hypothesis*). Full template + worked examples in the `github-tasks` skill (epic #359).
