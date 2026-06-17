# Blog POC via /task-decompose — Retrospective

**Date:** 2026-06-17
**Initiative:** Epic #257 — proof-of-concept blog app (`apps/blog`)
**Scope:** scaffold (#258) → posts collection via crouton CLI (#259) → public reader (#260) → verification (#261)
**Outcome:** ✅ Built, merged onto `claude/blog-poc-p70yl4`, visually verified live (screenshots). Not yet on `main`.

This is an honest account of running the recursive `/task-decompose` agent pipeline end to end on a real (if small) feature, in the Claude-Code-on-the-web sandbox.

---

## What went well

1. **The decomposition shape was right.** One epic → four sub-issues with a clean dependency chain (scaffold → collection → reader → verify). The LEAF TEST correctly classified all four as leaves at depth 1 — no over-splitting, no runaway recursion. The tree structure (real GitHub sub-issues with progress bars) survived multiple session suspends.

2. **The crouton CLI delivered.** From a 7-field spec it generated a complete, typechecking collection: Drizzle schema, SQLite migration, team-scoped CRUD API routes, admin List/Form components, composable, and types. This was the core thing the POC set out to prove, and it held up — the generated code needed zero hand-fixing.

3. **Typecheck-as-gate held the line.** Every piece was gated on `pnpm --filter blog typecheck` before merge. Nothing red ever landed. The stacked-PR-onto-epic-branch topology kept `main` untouched while pieces accumulated.

4. **Non-fatal noise was correctly ignored (eventually).** The `@nuxt/fonts` "Host not in allowlist" errors are pure sandbox artifacts (blocked font CDNs). Once recognized, they were correctly treated as noise rather than chased.

5. **Real screenshots from a headless sandbox.** Despite no browser install path (the Playwright CDN is egress-blocked), a pre-installed chromium at `/opt/pw-browsers/` + seeding SQLite directly produced genuine rendered proof: published list, draft-hidden, single post, auth-gated admin.

---

## What went wrong

1. **A background worker was orphaned by a session suspend (the big one).** The #259 worker finished generating the collection but the session suspended/resumed before it committed, pushed, or opened its PR. Its work sat **uncommitted in a worktree**, invisible to GitHub. Only a manual takeover (re-run typecheck → commit → push → PR) recovered it. **Background sub-agents do not survive a session suspend with uncommitted work.**

2. **The scaffold worker (#258) churned badly.** It ran ~36 min, booted the dev server **six times**, launched duplicate dev servers on the same port, and at one point switched the *main* checkout's branch. The trigger was almost certainly the font `ERROR` lines — it kept re-verifying instead of converging. The work was fine; the path to it was wasteful and gave poor "is it stuck?" signals.

3. **`Closes #NN` never auto-fired.** Because every sub-PR targeted the **epic branch**, not `main`, GitHub's auto-close didn't trigger — #258/#259/#260 all had to be closed by hand. Predictable in hindsight, but the merge topology wasn't thought through up front.

4. **The pipeline didn't fully self-drive.** After the #259 loss, the reliable move was for the orchestrating session to build #260 and #261 *itself* rather than spawn more fragile workers. That worked, but it means the "spawn agents to build it" promise degraded into "one durable orchestrator does it." Fine for a POC; a gap at scale.

5. **Label bootstrap chicken-and-egg.** A new app needs an `app:blog` label, but labels only sync to GitHub on merge to `main` — so it couldn't be applied to the very issues tracking the work. Sub-issues fell back to `spike`+`type:*` with the component named in the body. Minor, but friction every new-app initiative will hit.

6. **Polling instead of push.** Progress was only visible when the user typed "check." The async pipeline never proactively reported, and long-running workers compounded the silence.

---

## What can be better

**Worker durability (highest priority)**
- Workers should **commit and push early and often** — even a WIP commit before any long verification step — so a suspend can't orphan work. A pushed branch is recoverable; an uncommitted worktree is not.
- Treat "generation/edit complete" as an immediate **checkpoint**: commit before booting anything.

**Sandbox-aware verification**
- In this environment, **typecheck + code review is the reliable gate; booting the dev server is not** (SSR stalls ~12s on blocked font CDNs). Workers should be told this up front (telling #259 helped — it didn't churn like #258). Bake a `SANDBOX=offline` hint into the worker prompt, or disable `@nuxt/fonts` remote providers in dev.
- Better still: **add the font CDNs (and the Playwright download host) to the environment's egress allowlist** so dev boots cleanly and browsers are installable. The whole font-churn class of problems disappears.

**Merge topology, decided up front**
- For a stacked initiative, pick one and commit to it: (a) accept manual sub-issue closes as part of the process, or (b) put all `Closes #NN` lines in the final **epic→main** PR so they close on the real landing. Don't discover it mid-flight.

**Proactive progress**
- The pipeline (or orchestrator) should post a one-line status to the epic as each child opens/merges, and/or schedule a self check-in, so the owner isn't polling.

**Label pre-flight**
- Add a bootstrap step that creates a new `pkg:`/`app:` label (via the labels workflow `workflow_dispatch`) *before* opening issues, or standardize the body-naming fallback so it's not re-decided each time.

**Decomposition should flag integration seams**
- The generated CRUD is **team-scoped (multi-tenant)**; a public blog is **anonymous, cross-team, read-only**. The reader needed its own public endpoints rather than reusing the team-scoped ones. The #260 spec half-anticipated this, but decomposition could call out known seams like this explicitly so the worker doesn't rediscover them.

---

## One-line verdict

The pipeline's *structure* (epic → leaf-tested sub-issues → PRs) is sound and the crouton generator is genuinely good. The weak link is **worker durability under session suspend** and **sandbox-induced churn** — both fixable with "commit before you verify" discipline and an egress/offline-fonts tweak. With those, this same run would have been hands-off instead of needing a human-driven recovery.
