---
name: ask-human
layer: method
description: Emit a blocking question the owner can read in ~10 seconds and answer in one reply — the scannable, recommendation-first handoff every agent posts when it hits a fork it can't own. Leads with the one decision + a recommendation, carries the 🤖 provenance header, doubles as the #639 resume brief. Use the moment you decide (via the AGENTS.md decide-vs-ask test) that a fork is genuinely the human's, or when asked to "ask the human", "post a blocking question", "hand this off", run /ask-human.
allowed-tools: Bash, Read, Grep
---

# Ask the human — the scannable, one-decision handoff

You hit a fork. **First apply the decide-vs-ask test** (`AGENTS.md` → *Deciding vs
asking*): ask **only** when it's irreversible/expensive **and** not derivable **and**
genuinely the human's call. If any one fails → **decide + log** a Decisions-log line and
keep moving. Don't reach for this skill to dodge a call you can make.

If it *is* ask-worthy, this skill is how you ask **well**. The owner may be holding ~20
async threads on their phone: the comment must be graspable in **~10 seconds**,
**self-contained** (a fresh session resumes from it with zero memory — #639), and it must
**always propose an answer**. Never post a naked "what do you want?".

## The template

Post this as a **top-level issue comment** (`add_issue_comment`) — never a PR *review* body
(the owner misses those, #846). One decision per comment; batch related questions into it.

```
## 🔀 Blocked — <the one decision, in one line>
> 🤖 **Claude Code** · interactive agent · posted from @pmcp's account (not Maarten) · _<one-line context>_

**TL;DR — recommend <X>:** <the decision restated + why X is your pick, in one or two lines>
**Status:** <what's done · `branch-name` pushed? · what's NOT done>
**Why it came up:** <what cannot proceed until this is answered>
**Options:**
  - **A) <label>** — <consequence> _(recommended)_
  - **B) <label>** — <consequence>
**Reply:** `A` or `B` (or in-medium — see below). Your reply spawns a fresh session that
resumes from THIS ticket; `lgtm`/`approve` if A-as-recommended is fine.
**Don't lose:** <decisions/assumptions the next agent must carry forward>
```

Rules that make it work:
- **Lead with the decision + a recommendation.** The first two lines must answer "what's
  being asked, and what does the agent suggest?" with no scrollback.
- **Always a recommendation.** You did the work; you have an opinion — state it and why.
- **Provenance header is mandatory** (enforced by `require-comment-provenance`). Interactive
  agents post under @pmcp's account → use the "not Maarten" disclaimer above. A bot-account
  pipeline comment uses `> 🤖 **<tool>** · agent pipeline (CI) · _<context>_` instead (no
  @pmcp disclaimer — it'd be false).
- **@mention only because action is needed.** This is an ask → `@mention @pmcp`
  (`NOTIFY_HANDLE`). Pure FYIs get no mention.
- **Push before you block.** If you've written anything, `git push -u origin <branch>` first
  and name that branch under *Status* — an unpushed worktree is lost on stop (#639).
- Then apply `status:blocked` and **stop**.

## Attach the right medium

**Prose is the fallback, not the default.** If the question is visual or structural, a
paragraph is the *wrong* channel — the owner shouldn't have to reconstruct a layout or a data
model in their head. Attach the artifact that **shows** it, and let them reply *on the artifact
itself* (the reply loop is WS5, #1191). We already own every medium — pick by what the question
*is*, not by habit.

| Your question is about… | Attach (medium) | Produce it with | Owner replies by |
|---|---|---|---|
| **How it looks / feels** (a rendered UI, spacing, copy, states) | live preview | `ui-proposal` (staging deploy, `NUXT_PUBLIC_CROUTON_REVIEW=true`) — or a screenshot if no runnable app | pinning feedback on the preview → `🎯 Preview feedback` comment naming the file; or `A`/`B` |
| **One screen / one state** (a single view, an error, a before/after) | screenshot | `node scripts/app-shots.mjs <baseUrl> <path[:name]>` → `screenshots/<name>.png` | commenting / `A`/`B` |
| **A flow or interaction** (multi-step, timing, motion) | short video | `demo-video` (WebM storyboard) | commenting |
| **The data model** (fields, types, relationships) | schema render | `schema-review` (→ PNG/HTML/MD) | inline comment on the committed `.md`; or `A`/`B` |
| **Structure / status / dependencies** (what depends on what, where the tree is) | diagram | `ticket-diagram` (Excalidraw on the epic) | editing the Excalidraw → `scripts/ticket-excalidraw-import.mjs` round-trips it back; or `A`/`B` |
| **A tradeoff / priority / naming** (no visual or structural surface) | prose | the block above | `A`/`B`/`lgtm` |

Rules:
- **One artifact, the most direct one.** Don't attach three renders "to be safe" — pick the
  medium that answers *this* question fastest and link it from the blocking comment.
- **The artifact supplements the block; it doesn't replace it.** Still lead with the decision +
  recommendation in text — the artifact is the evidence, the block is the ask.
- **Screenshots land in `screenshots/`** (gitignored) — never the repo root or an app dir.
- **Reuse the skill, don't reinvent it.** Each medium is its own skill/script with its own
  gotchas; invoke it, don't hand-roll a render.
- If producing the artifact would cost more than the answer is worth (a deploy for a one-line
  copy tweak), fall back to a screenshot or prose — match the effort to the stakes.

## Why this shape

- **10-second-scannable** → the owner triages 20 threads without opening each.
- **Recommendation-first** → most replies collapse to `lgtm`, one round-trip (epic metric #1).
- **Self-contained** → the resuming session (`resume-on-comment.yml`, fresh, checks out
  `main`) continues from the branch + comment without re-deriving or diverging (#639).

This **extends #639** (the handoff block) — it doesn't replace it. #639 gave the block its
state/after/don't-lose fields; this adds the scannable lead + the always-a-recommendation
rule and packages it so every agent emits the same shape.
