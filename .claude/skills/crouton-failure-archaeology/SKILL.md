---
name: crouton-failure-archaeology
layer: stack
description: The case-law chronicle of this repo's major failures — symptom, root cause, evidence, status, and the rule each battle minted — so nobody re-fights a settled battle or re-proposes a rejected fix. Use when a bug/incident looks familiar ("didn't this happen before?"), when you're about to propose an approach that may have been tried and rejected (e.g. shipping a migration from a package), when someone asks "why does rule X exist" / "why is done-by-lgtm a thing" / "what was incident 988", or when a bug-archaeology run hits the shallow-clone wall and needs the pre-June-2026 history. Trigger phrases: "has this broken before", "why can't packages ship migrations", "why did graduation fail", "why is the green-build lesson a rule", "what did we learn from incident NN". (For a live "build is green but the app is broken" symptom, start at crouton-diagnostics-index. NB keep this description free of any space-then-hash sequence — an unquoted YAML scalar treats space-hash as a comment start and silently truncates.)
---

# Crouton Failure Archaeology — the settled battles, as case law

The chronicle of every major incident in this repo, so a fresh session cites precedent instead of re-deriving it and never re-proposes a rejected fix. This file owns the **stories and the why**; the symptom → fix mechanics for each incident live in sibling `crouton-diagnostics-index` — narratives here link there, never restate.

## When to use / when NOT to use

| Situation | Go to |
|---|---|
| "Why does this rule/gate exist?" · "has this failure happened before?" · about to propose an approach that smells familiar | **this skill** |
| A live bug just got reported — you need the *protocol* (first-bad-commit, record before fix) | `bug-archaeology` skill (it owns the how; this owns the what-already-happened) |
| An epic just closed — you need the *retro mechanics* (what-went-well comment, minting `workflow` issues) | `postmortem` skill |
| A symptom → root-cause lookup for a *current* error message, and each incident's fix mechanics | `crouton-diagnostics-index` (fast lookup; this skill carries the story behind those entries) |
| Which gate fires on your change, approval semantics | `crouton-change-control` |
| The live #983/#992 graduation rebuild itself | issue #983 + the `graduate` skill (point-in-time snapshot: `writeups/briefings/crouton-builder-graduation-campaign-20260702.md`) |
| The architectural WHY behind an invariant | `crouton-architecture-contract` |

Jargon used below: **crouton** = this repo's schema-JSON → generated CRUD system (the `packages/*` layer — mostly `@fyit/crouton-*` Nuxt layers, plus the CLI/MCP/module exceptions; see `crouton-architecture-contract` §1); **POC** = an incubating app under `pocs/`; **graduation** = rebuilding a proven POC as a real crouton app/package (`graduate` skill); **fixture** = a throwaway generated app under `fixtures/` that the e2e smoke boots; **NuxtHub** = the storage abstraction mapping `hub:{db}` to Cloudflare D1.

## ⚠️ The shallow-clone wall (read before doing any git archaeology here)

The local checkout is a **shallow clone**: `git rev-parse --is-shallow-repository` → `true`, with grafts in `.git/shallow` and local history starting around **2026-06-19** (exact horizon: re-verify block below). `git tag` is empty (the `graduation-v1-reserve` tag from #992 is not fetched). Consequences:

- `git log -S` / `blame` / `bisect` **cannot see anything before the graft horizon** (~issue #421 era). History older than that must go through **GitHub issues/PRs** (`FriendlyInternet/nuxt-crouton`, via the GitHub MCP tools) — never conclude "it was never in git" from a local miss.
- Battles below marked **(pre-shallow)** are evidenced by GitHub issues only; SHAs marked **✓** were verified in the local clone (see Provenance).
- Related trap: shallow clones silently defeat git-delta computations in CI too (skills-digest postmortem, #838 → fix minted as #1027: `fetch-depth: 0`).

---

## A) The theory: the proxy-for-done failure class

The single most important recurring failure in this repo: **every proxy for "done" can be true while the work is wrong** — and in real incidents, several lied *at once*. This is now codified as the AGENTS.md "Done is signed off, not asserted" rule; this section is the case law that makes it stick — its one home besides AGENTS.md's rule statement. (Live "deployed but 500s" triage: `crouton-diagnostics-index`.)

| Case | The lying proxy | What actually happened |
|---|---|---|
| **#988** graduation 500 | green build + clean typecheck + live deploy URL + agent confidence — **all four at once** | The graduated builder app (WS5 of epic #983) built, typechecked, deployed to `crouton-builder.pmcp.dev` with green CI including a remote D1 migration and a working test login — and **500'd at runtime on every request**. Three compounding sins (retro comment on #983, 2026-06-30): (1) ported POC code despite the skill saying *don't port*; (2) hand-assembled the app instead of `crouton init` — no `server/db/schema.ts`, the entry NuxtHub builds the runtime DB schema from; (3) no real collections. Cost ~a session of blind debugging. WS5 reset from scratch (PR #991 closed unmerged). |
| **#603 P0** | a "success" workflow run | Plan-approval resume ran green but **created zero sub-issues** — a silent no-op that looked done. Fix `2328016` ✓: artifact-gate on `resume-on-comment.yml` — a resume producing nothing observable goes red. |
| **#603 P1** | an agent's exit code (inverted: false-**red**) | Red-team agent hitting `max_turns` exited 1 → job red on every PR even with zero findings. Fix `4625c95` ✓: the **verdict-check step alone** decides pass/fail, never the agent's exit code. |
| **#1019** | a stale linked PR | The pi.dev flow's pass-set accepted a bare `alreadyLinkedPR` — an unrelated stale cross-ref false-greened a no-op run. Fix `89436bb` ✓: a fresh-work run needs a **fresh deliverable produced this run**. |
| **#1034** | a green CI gate | The frontend-review gate (#834) "shipped **green while enforcing nothing**" — fail-open — and the same latent bug silently disabled the a11y (#726) and red-team (#540) gates too. Root causes: no positive-case ("bad → red") test; undocumented tool-permission grant; agent outage indistinguishable from a clean scan. Fixed #1031/#1033; hardening children #1035–#1037 minted (live status: `crouton-ci-and-deploy-map` §5 + re-verify below). |

**The uniform cure, applied every time:** derive status from a **verified artifact produced this run** or a **recorded human sign-off** (`lgtm`/`approve` comment) — never from an exit code, a green check, a deploy URL, or self-report. Enforcement now exists in code: `.claude/hooks/gate-spec-signoff.mjs` ✓ blocks a `spec.json` entry flipping to `settled` without a recorded `signedOff` (commit `9b99005` ✓, #997). Related: #695's postmortem — "a green build would have lied": everything seeded into the wrong org; caught only because the author *walked the advertised path* (the review login opened an empty app). Comparison against the expected result, not re-reading the checklist, is what finds these.

## B) Tier-1 battles

Each row: what broke → why → the evidence trail → where it stands → the durable rule it minted. Symptom + fix mechanics for each: `crouton-diagnostics-index`. SHAs with ✓ verified locally (see Provenance).

| Battle | Symptom | Root cause | Evidence | Status | Rule minted |
|---|---|---|---|---|---|
| **#988 graduation 500** | Story + root cause: §A above | — | #983 retro comment 2026-06-30; PR #991 closed unmerged; `9b99005` ✓ | rebuild tracked on #988; method rewrite #992 (live state: re-verify) | AGENTS.md done-rule; `spec`/`graduate`/`conformance` skills; `gate-spec-signoff.mjs` |
| **#523/#457 zero-migration scaffold** | Fresh scaffold ships **zero migrations, silently**; first deploy fails (fix: diagnostics-index) | `db:generate` needs the built `schema.mjs`; the CLI ran it bare | Fix `e4d92da` ✓ (2026-06-20): build-first generation in `packages/crouton-cli/lib/utils/generate-migrations.ts`; prints manual steps instead of shipping nothing | Fixed | Build-first migration generation; fail loudly or print the recipe (mechanics: `db-migrations` skill) |
| **#138 `--config` path-doubling** (pre-shallow) | Staging D1 migrate: "No migrations present" though migrations exist (fix: diagnostics-index) | wrangler resolved the relative `migrations_dir` against the passed config's dir. Was **latent in the scaffolder template too** — triage dodged it by reusing a pre-migrated DB (folded back via #135) | PR #138 body (GitHub only) | Fixed; rule enshrined in root CLAUDE.md | Wrangler resolves relative paths against the config file's dir; a template "working" on app A can carry a latent bug A merely dodges |
| **#624 maplibre CJS crash** (aftershock of the #538 Mapbox→MapLibre swap, `48ef1b8` ✓) | Maps forms crash the page in dev — named-import failure against raw CJS (mechanics + fix: diagnostics-index) | maplibre-gl v5 is CJS-only and was in `build.transpile` | Fix `9cc0d4c` ✓; caught by the `with-maps` e2e fixture (#549) | Fixed | The `provider-swap` skill was minted from #538; a swap is only proven when a fixture exercises it in a browser |
| **#680/#685/#700 translations_ui 500** | Fresh app admin 500: `no such table: translations_ui` (fix: diagnostics-index) | The **rejected fix is the story**: PR #685 shipped the migration from the package — verified **closed unmerged** (`merged:false`). Rejection reason (commit `9515df1` ✓ body, verbatim): "NuxtHub applies package-layer migrations BEFORE the app's own (directory order), so a package `translations_ui` migration ALWAYS ran first and collided with existing apps' non-idempotent migration ('table already exists') — **unfixable by renaming**" | Actual fix: graceful degradation (mechanics: diagnostics-index); chain `9515df1` ✓ → `6ddb699` → merge #700 | Fixed | **Packages must not ship D1 migrations for infra tables consumed by pre-existing apps**; optional-table reads degrade, don't crash. Sanctioned package-owned-table pattern: `db-migrations` skill |
| **#740→#745 devtools deploy cache corruption** (3 rounds) | POC deploy fails at `nuxt prepare`: "Could not load @fyit/crouton-devtools" (symptom row: diagnostics-index) | R1 `094ae41`: symptom-workaround (removed the module). R2 `7b77d47`: always build devtools dist. R3 `7d781bf` ✓ — the real bug: the shared layer-dist **cache was keyed on a static version**, so a cache hit restored a dist set missing packages across apps building different package sets | Fix: key the cache on the resolved build-set identity; proof `034a42a` ✓ restored the review overlay | Fixed | A shared build cache keyed without build-set identity corrupts across consumers; a "fix" that bumps a cache version papers over it |
| **#133/#110 cross-env cookie/data leakage** (pre-shallow) | `__Secure-better-auth` cookie collisions — staging logins leaking into production; sibling #110: a fanfare PR preview could **read/write real till data** (shared prod DB) | One registrable domain for both envs; shared bindings | Epic #133 (closed 2026-06-15, GitHub only) | Fixed structurally: prod → `<app>.friendlyinter.net`, staging → `<app>.pmcp.dev` — separate registrable domains; per-env D1/KV ids (bindings don't inherit across wrangler envs) | **Prefer structural impossibility over convention** — the repo's signature move (also #347: a `push` event can never set `environment=production`) |
| **#552–#556 day-one red-team auth findings** | Within days of the red-team agent shipping (#540) | (a) Invitation-resend **born-broken**: `getOrganizationMembershipDirect` used a bare `member` symbol never imported → ReferenceError, *plus* call-site args swapped vs the `(organizationId, userId)` signature — verified in `f9219b4` ✓ body; failed closed since PR #248, so nobody ever successfully resent an invitation. (b) Scoped-access mint **trusted the token role from the request body** while only checking the caller was any member → member could mint an elevated token | Fixes `f9219b4` ✓ (#552), `19e4c30` ✓ (#556, admin/owner only), `b692d5b` ✓ (#554 refresh hardening) | Fixed | "Fails closed" can hide being completely broken; never trust role/privilege fields from the request body; adversarial review pays immediately on auth surfaces |
| **#108 Workers→Pages→Workers boomerang** (pre-shallow) | N/A — a platform decision, not a breakage | Apps ran on Workers, moved to Pages (commit `ee2946ed`, 2026-01-18, "simplify hub.db config") — then Wrangler auto-provisioning (4.45+) killed exactly the friction that motivated the move, so #108 moved back to Workers, piloted on throwaway `three-demo` first | Epic #108 (closed 2026-06-15, GitHub only); root CLAUDE.md "not Pages — ignore older docs/commits that say Pages" | Settled: Workers is the standard | Platform decisions are timestamped simplifications, not doctrine — re-litigate when the underlying constraint dies |

## C) Tier-2 skirmishes (one line each; know they exist, pull the issue for detail)

- **#722 editor revert→rebuild** — full-takeover pages editor reverted wholesale (`62e7fc7` ✓ — note: some reports mistype this as `62e7cf7`), then rebuilt smaller as a Teleport-same-instance fullscreen "focus mode" (`0911533` ✓): when a UI change is too invasive, revert fully and re-scope.
- **#888 pi.dev onboarding** — every "should just work" bridge failed: a `PROMPT=$(cat <<EOF…)` heredoc-in-`$()` quote-bombed on a lone apostrophe (`ec84c3b` ✓); the `.pi/skills → .claude/skills` symlink **silently didn't load** — must pass `--skill` explicitly (`50f7788` ✓); Haiku stalled asking questions → Sonnet default + non-interactive directive (`89436bb` ✓, #1019).
- **#424 the archaeology-first motivator** (pre-shallow) — "crouton-printing could not be resolved" looked like a code bug; was a **stale pnpm symlink**. A symptom-first fix would have edited unbroken package code → the `bug-archaeology` HARD GATE.
- **#751/#787 stale-main near-miss** — first extraction branch cut from a local `main` **231 commits behind origin**; "one `git push` away from a 231-commit revert PR". Mitigation issue #787 (SessionStart stale-main warning): live state in re-verify — check `git fetch && git status` yourself either way.
- **#695 seed-wrong-org** — packages seeded everything into `seed:org:test1` while the advertised review login created a fresh empty org; green build, wrong result; caught only by walking the advertised path. Gotcha: `crouton-seed` discovers providers via the **package graph, not nuxt.config `extends`** (#698).
- **#686 pipeline-stops-at-epic-branch** — all workstreams merged into `epic/686-…`, sub-issues closed, epic looked done, **nothing reached `main`** until a human opened PR #1049. Its postmortem calls this "the sharpest lesson"; also "decided ≠ built, twice" (a workstream dropped from decomposition; another landed docs-only).
- **#504 the 967-line stale CLAUDE.md clone** (pre-shallow) — `docs/CLAUDE.md` had drifted into a stale copy of the old root, still ordering a removed "code word" ritual and Pages deploys. "Detection, not the fix, was the hard part." → the never-restate/index-and-defer rule this very library obeys. (Removal commit `763b548` — unverified locally, pre-shallow.)
- **#1056 teardown false-failure** — re-running teardown on already-deleted Cloudflare resources reported red: the error classifier read `err.message` while stderr was **inherited, not piped**, and missed CF's real phrasings (`code: 10007`, "Couldn't find DB"). Fix `15da00b` ✓: shared `isAlreadyGone()` in `scripts/lib/wrangler-d1.mjs` ✓ + a node --test regression. Had earlier bitten #686's retirement of three-demo/thinkgraph.

Related archaeology trap: retired code lives in `retired/pocs/` ✓ (`blog`, `three-demo`, `thinkgraph*` — `1ad09fe` ✓, #1043), but `thinkgraph` **also** exists in the older undocumented `_archive/` ✓ (with `atelier`, `crouton-designer`) — a duplication trap when grepping "where did X go". `_archive/` predates the `retired/` convention and is documented nowhere in root CLAUDE.md.

## D) Cross-cutting lessons (what the harness now enforces)

1. **Proxies for "done" lie** — green build (#988), agent exit code (#603), "success" no-op run (#603 P0), stale linked PR (#1019), green fail-open gate (#1034). Cure, every time: verified this-run artifact or recorded sign-off. Now the AGENTS.md done-rule.
2. **Structural impossibility beats convention** — two registrable domains (#133), dispatch-gated prod env (#347/#318), PreToolUse hooks (`gate-package-edits.sh`, `require-comment-provenance.mjs`, `gate-spec-signoff.mjs` — all present in `.claude/hooks/` ✓).
3. **Fixtures are the early-warning radar** — `with-maps` caught the maplibre CJS bomb (#624); the e2e harness exists because package changes ripple into consumers.
4. **"Silently produces nothing" is the worst failure mode** — worse than a crash: zero migrations (#523), skill-blind pi (#888), no-op resume (#603 P0), fail-open gates (#1034). Fail loudly or print the recipe.
5. **Every incident mints a gate or skill** — #538→`provider-swap`, #988→`spec`/`graduate`/`conformance`, #424→`bug-archaeology`, #618→`remove-app`, #1034→#1035–#1037. The `postmortem` loop (#403) is the minting mechanism.

## E) How to extend this chronicle

When you close out a real battle (not a routine bug):

1. Run the `bug-archaeology` protocol *during* the fight (first-bad-commit or non-code-cause, recorded on the issue) and the `postmortem` skill at epic close — both are prerequisites, not replaced by this file.
2. Then add **one row/line here** (Tier-1 if it minted a durable rule, Tier-2 otherwise): symptom → root cause → evidence (SHA if post-shallow-horizon and mark it ✓-verifiable; issue/PR number otherwise) → status → rule minted. Put the **fix mechanics** in `crouton-diagnostics-index` (one row, keyed on the error string) and link it — never restate them here.
3. If the incident is another proxy-for-done case, add it to §A's table — that class is the one this repo most needs to keep visible.
4. Never record a rejected approach without the *why* — #685's rejection rationale is the most-reused sentence in this file.

## Provenance and maintenance

Facts verified against: the local git clone (shallow status; all ✓-marked SHAs resolved with `git log -1 <sha>`); GitHub via MCP (`FriendlyInternet/nuxt-crouton`: #988 body/labels; PR #685 closed with `merged:false`; epic #1034 body matching the fail-open account); the filesystem (`.claude/hooks/gate-spec-signoff.mjs`, `isAlreadyGone` in `scripts/lib/wrangler-d1.mjs`, `retired/pocs/` + `_archive/` duplication). Pre-shallow items (#108, #110, #133, #138, #424, #504, and commits `ee2946ed`/`763b548`) are from GitHub issue/PR bodies as summarized by the 2026-07-02 discovery sweep — cite the issue number, re-check on GitHub if load-bearing.

verified: 2026-07-02

```bash
git rev-parse --is-shallow-repository && wc -l .git/shallow && git log --reverse --format='%h %ad %s' --date=short | head -1   # still shallow? graft count (was 16) + oldest local commit (was 5647b32, 2026-06-19)
git log -1 --format='%h %s' e4d92da 9cc0d4c 7d781bf 15da00b 9b99005                                      # tier-1 SHAs still reachable?
ls .claude/hooks/gate-spec-signoff.mjs && grep -n isAlreadyGone scripts/lib/wrangler-d1.mjs | head -1     # enforcement artifacts still exist? (isAlreadyGone was line 83)
# live issue state (drifts — re-read via GitHub MCP): #988 (open/in-progress as of 2026-07-02), #992 (status:ready-to-close as of 2026-07-02),
#   #1034 children: #1035 (closed 2026-07-02), #1036/#1037 (open as of 2026-07-02), #787 (open as of 2026-07-02)
```
