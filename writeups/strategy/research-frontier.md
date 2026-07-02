> ⚠️ **Strategy snapshot (2026-07-02), non-authoritative** (#504 — writeups are historical thinking, not standing directives). Originally authored as a skill in PR #1091 (epic #1073); relocated here because the three fronts are current strategic opinion pinned to live issues, not durable agent capability. The durable evidence-bar rules live in AGENTS.md § Observe the harness.


# Crouton Research Frontier — where this project can advance state of the art

One-line purpose: the owner's three named research fronts, the evidence bar for claiming anything, and where good ideas historically came from — so a successor session invests where the leverage is and never oversells.

**Standing rule: nothing on this page is a result yet.** Every claim is labeled `open` or `candidate`. All work toward these fronts goes through the normal loop — issue-first, sign-off gates, staging-only deploys (`crouton-change-control` sibling is the router). This skill grants no shortcuts.

## When to use / when NOT to use

| You want | Go to |
|---|---|
| Decide what novel work is worth doing; frame a claim honestly | **this skill** |
| Prior-art check before building anything ("is this already solved?") | `ecosystem-check` skill |
| Retro / mint improvement proposals at epic close | `postmortem` skill |
| Run the harness measurements (context budget, traces) | `loop-station` skill |
| Interpret those measurements + the eval ledger, pick evidence tools | `crouton-harness-observability` sibling |
| Execute the live #983 graduation (Front 2's running experiment) | `crouton-graduation-campaign` sibling |
| Layout engine theory (LayoutTree, viability math, placer rules) | `crouton-layout-reference` sibling |
| The honest test-coverage picture behind any "it's tested" claim | `crouton-validation-reality` sibling |
| The incident case law referenced below, in full | `crouton-failure-archaeology` sibling |

---

## Front 1 — the harness/method: agent-run development, declared as data and measured

**Why current SOTA fails.** Published agent-coding setups assert "done" from proxies — green CI, a deploy URL, the agent's own report. Their methods live in prose (blog posts, README conventions), not machine-readable config, so nothing can check the method against itself. And nobody publishes the *negative* case law: the catalog of ways a proxy-for-done lied in a real project.

**This repo's asset.** The method is *declared as data* and *measured*:

| Asset | Where (verified 2026-07-02) |
|---|---|
| Stack-neutral constitution + stage profile + stack adapter | `AGENTS.md` · `harness.config.mjs` (resolver: `node scripts/harness-stages.mjs <path>`) · root `CLAUDE.md` |
| Model routing as data | `.claude/routing.json` (descriptive today; its own `_known_gaps` admits the top-level CI loop model is **UNPINNED**) |
| Context-budget + trace measurement | `.claude/skills/loop-station/` scripts; committed `writeups/loop-station/history.jsonl` |
| Cost-per-outcome ledger with a recorded **gold negative** | `writeups/reports/eval-ledger.jsonl` (the reverted #862 pi/Haiku spike, `outcome:"reverted"`) |
| Done-rule enforced in code, not prose | `.claude/hooks/gate-spec-signoff.mjs` (blocks `settled` spec entries without `signedOff`) |
| Proxy-for-done case law | #988 (green build/typecheck/deploy URL/agent confidence all lied at once), #686, #695, #603, #1034 — full chronicle in `crouton-failure-archaeology` |

**First three steps in this repo:**

1. Baseline the measurement: `node .claude/skills/loop-station/gather.mjs --pretty` and `tail -1 writeups/loop-station/history.jsonl` — interpretation rules (tokenizer eras, red thresholds) in `crouton-harness-observability`.
2. Finish gate honesty (#1034): #1035 (known-bad fixture must turn each agent gate red) **closed 2026-07-02**; #1036 (tool-permission grant in the workflow standard) and #1037 (agent outage ≠ clean scan) **still open**. Until all three land, "every gate honest" cannot be claimed.
3. Drive one real epic end-to-end via `/task-decompose` and *record* the run: human code edits (target: 0), gate verdicts per sub-issue, whether the result reached `main` unaided (the #686 failure: "the pipeline stops at the epic branch"), and cost via the eval ledger (`scripts/eval-ledger/append.mjs`).

**You have a result when** (falsifiable, all together, evidence recorded on the epic): a full epic runs idea → sub-issues → PRs → `main` with **zero human code edits**; every fired gate resolved by a recorded `lgtm` comment (never a proxy); each agent gate demonstrably honest (its known-bad fixture turns it red — the #1035 mechanism — and an induced agent outage is visibly not a clean scan, #1037); the whole run costed in the eval ledger. Status: **open** — prerequisites #1036/#1037 open as of 2026-07-02.

## Front 2 — the generator: schema → working team-scoped app, with fidelity you can gate

**Why current SOTA fails.** LLM scaffolding is non-deterministic — regenerate and pray, no regression surface. Low-code/no-code platforms are deterministic but lock you in. Crouton's bet is deterministic generation *of code you own*: the vision doc's thesis "ours appreciates, theirs degrades" (`writeups/strategy/crouton-vision.md:21` — which itself admits at line ~101 this is "faith, not data"; epic #945 is the measurement half, open/in-progress).

**This repo's asset.**

| Asset | Where (verified 2026-07-02) |
|---|---|
| Manifest-driven field types (extensible, not hardcoded) | `packages/crouton-core/crouton.manifest.ts` loaded by `packages/crouton-cli/lib/utils/manifest-loader.ts` |
| Deterministic artifact set per collection (16 template generators, no LLM in the generate path) | `packages/crouton-cli/lib/generators/` — full artifact list in `crouton-generation-reference` |
| Regression radar: 7 real generated fixture apps on disk, **6 smoked in CI** (`with-collab` deliberately excluded until type-clean, #210) | `fixtures/` + `e2e/` harness — the honest split is owned by `crouton-validation-reality` §3 |
| Team-scoped multi-tenancy baked into every generated API | `/api/teams/[id]/…` routes — model in `crouton-architecture-contract` |
| A machine-checkable "is it a real crouton app" gate | `conformance` skill (C2 of graduation) |

**First three steps in this repo:**

1. Prove the radar works for you once: `E2E_FIXTURE=minimal BETTER_AUTH_SECRET=dev BETTER_AUTH_URL=http://localhost:3000 pnpm test:e2e` (mechanics + fixture choice: `e2e-smoke` skill; honest-coverage caveats: `crouton-validation-reality`).
2. Work the live experiment: the #983 builder graduation (open, `status:in-progress`) is the acceptance test of schema→app fidelity under the #992 spec-driven method — sequence and fences live in `crouton-graduation-campaign`. Do not restart it; pick it up there.
3. Close the measurement half: epic #945 (`crouton-analytics`, open) auto-instruments generated POCs so "is it used?" becomes data — its own `## 🧪` block defines the end-to-end pass.

**You have a result when**: a *fresh* schema JSON → `crouton config` → deployed staging POC that passes `/conformance` **and** the e2e smoke with **zero hand edits to generated code**, plus (per #945) real usage events observed from that deployed app. The "appreciates" thesis graduates from faith to data only when #945's funnel shows real use of a generated app. Status: **open** — #983 is the live experiment; #988 is the recorded failure of the shortcut path (porting/hand-assembling instead of generating).

## Front 3 — the layout engine: viability-gated auto-layout from data shape

**Why current SOTA fails.** Auto-layout elsewhere is either rigid template-picking or LLM-generated UI with no objective acceptance function — nothing *gates* a proposed layout on a measurable contract, so quality is vibes. Crouton's engine has a cheap, deterministic, regression-testable definition of "good enough": viability.

**This repo's asset.**

| Asset | Where (verified 2026-07-02) |
|---|---|
| Viability metric: layout is viable iff every block gets ≥ its declared `minWidth` at target widths (default `[1280, 768]`) | `packages/crouton-layout/app/utils/layout-viability.ts` (#710); unit tests `layout-viability.test.ts` |
| Deterministic placer — pure, no LLM, rejects non-viable candidates, falls back vertical; returns `{ viable, violations }` | `packages/crouton-layout/app/utils/layout-compose.ts` `composeDefaultLayout` (#709); tests `layout-compose.test.ts` |
| Sizing contract declared on block definitions (`minWidth`, `defaultSize`, `sizing: fill|hug`, variants) | `croutonLayoutBlocks` registry — theory in `crouton-layout-reference`, authoring in `block-authoring` |
| Layout is *data* (`LayoutTree` in `layout_configs`), diffable + serializable onto tickets | `layout-serialize.ts` / `layout-ticket.ts` |
| A pre-registered bar for any LLM layout pass | issue #711 (open, gated): LLM ships only if it beats the deterministic default in a **blind test** *and* stays viable |

**First three steps in this repo:**

1. Run the existing proof: `pnpm --filter @fyit/crouton-layout test` (script is `vitest run`; the compose/viability suites are in `app/utils/__tests__/`).
2. Close the declared drift hazard: `packages/crouton-cli/lib/compose-layout.ts` mirrors the block sizing registries by hand — hazard (and current values) owned by `crouton-layout-reference` §6. A sync check would make Front-3 claims trustworthy.
3. Gather the evidence #711 demands *before* any LLM pass: record deterministic-default failures (rejected layouts, user rework, mishandled collection shapes) on #711 — its entry gate requires evidence on the issue before code.

**You have a result when**: every fixture's generated default layout reports `viable: true` at the target widths with zero manual arrangement (measurable today — `composeDefaultLayout` returns it); and, if the LLM pass is ever attempted, it wins #711's blind test while staying viable. **Known honest gap:** viability currently checks `[1280, 768]` only — `writeups/reports/bookings-from-blocks-gap-report-20260701.md` shows side-by-side arrangements do **not** reflow at phone width 390 ("panes squish below their minimums"), and that compound *choreography* (cross-pane coordination) is hand-built, not derived from the tree. A phone-safe claim needs 390 added to the gated widths and a reflow strategy first. Status: **open**.

---

## A. The evidence bar (for claiming ANY result on any front)

Grounded in machinery this repo already runs — don't invent a new epistemology, use these:

1. **One mechanism must explain all observations, including the negatives, and survive adversarial refutation.** A result that ignores its own counter-evidence is the #988 pattern (four proxies true, work wrong). The repo's refutation surfaces: `red-team` (adversarial security), #711's blind test (adversarial quality), and the postmortem's "what was hard, with evidence".
2. **Hypothesis predicts numbers before running.** Every issue already opens with `## Hypothesis` … "We'll know by" (AGENTS.md). For frontier work, make the "know by" *quantitative before* the run — #711 ("beats the default in a blind test") and #945 ("funnel visible with no hand-written analytics code") are the house style.
3. **The idea lifecycle is enforced, walk it:** `pocs/*` (safe-to-fail, no gates) → behaviour captured at each sign-off into `<poc>/spec.json` (`spec` skill; schema in `pocs/CLAUDE.md`; `gate-spec-signoff.mjs` blocks un-signed `settled` entries) → `graduate` (rebuild, two acceptance axes) **or documented retirement** (`remove-app --archive` → `retired/`, or a "Considered & rejected" block on the issue). As of 2026-07-02 **no `spec.json` exists under `pocs/`** — the spec machinery is itself unexercised; the first real ledger is part of Front 1/2's result.
4. **Negative results are first-class data.** The eval ledger's gold negative (#862: pi/Haiku output merged unreviewed with full creds, reverted, minted the reports-only-first rule #867) is the model: record `outcome:"reverted"`, extract the rule.
5. **Prior art before novelty claims:** run `ecosystem-check` — a "frontier" that UnJS already shipped is not a frontier.

## B. What must be proven before saying anything publicly

- **Reproducibility: fresh clone → result.** If the demo needs your warm environment, it isn't a result. Cold-start recipe and its traps: `crouton-build-and-env`. Caveat: the local clone is shallow, so git archaeology beyond mid-June 2026 needs GitHub, not `git log` (see `crouton-failure-archaeology`).
- **The honest-coverage caveat.** "It's tested" is only claimable per `crouton-validation-reality` (many packages have zero unit tests; whole suites are skipped behind mocking walls). A green build is explicitly *not* evidence — that is the repo's central lesson (#988).
- **Security posture is unobserved, not proven clean.** Red-team findings are deliberately kept out of the public repo (email-only); the per-PR gate was fail-open until #1031/#1033. Never claim "no known vulnerabilities" — claim "no findings recorded in-repo, by design".
- **Measurement claims must respect the tokenizer-era rule** — don't compare loop-station trends across tokenizers (`crouton-harness-observability`).
- **Done is a recorded `lgtm`, never asserted** (AGENTS.md). A public claim about a gated deliverable cites the sign-off, or it isn't done.

## C. Where good ideas historically came from here

The pattern is consistent: **incidents mint gates; postmortems mint `workflow` issues.** New ideas should expect to arrive the same way — bottom-up from recorded pain, not top-down from vision docs (`writeups/` is explicitly non-authoritative, #504).

| Origin incident | Minted artifact |
|---|---|
| #988 green-build-that-500'd graduation | AGENTS.md done-rule, `/spec`, `/conformance`, `gate-spec-signoff.mjs`, epic #992 |
| #862 unreviewed merge with full creds | reports-only-first rule (#867); the eval-ledger gold negative |
| #834/#1034 fail-open review gates | known-bad-fixture smokes (#1035, closed), workflow standard (#1036), outage visibility (#1037) |
| #572 approvals via reactions/labels doing nothing | lgtm-comment-only resume signal, `resume-on-comment.yml` |
| #424 "code bug" that was a stale pnpm symlink | archaeology-first HARD GATE, `bug-archaeology` skill |
| #504 967-line stale CLAUDE.md clone | the no-restate/defer-to-root doc rules (the reason this skill indexes instead of copies) |
| #629 "no browser" when one was preinstalled | the verify-capabilities-don't-assume rule in root CLAUDE.md |
| Postmortem loop itself (epic #403) | `postmortem` skill: retro → proposals → `workflow` issues, deduped into umbrellas (#291, #515, #669) rather than minted fresh |

When one of the three fronts yields a lesson — positive or negative — this is the pipe it flows through: record it on the issue, postmortem it, mint the rule.

## Provenance and maintenance

**Facts verified 2026-07-02** against: the files named in each asset table (all confirmed on disk); `node scripts/harness-stages.mjs` run live; `composeDefaultLayout`/`checkLayoutViability` sources and their `__tests__/` read directly; `writeups/reports/eval-ledger.jsonl` and `writeups/loop-station/history.jsonl` read directly; `find pocs -name spec.json` → empty; issues #1035 (closed 2026-07-02), #1036, #1037, #983, #711, #945 fetched live via GitHub MCP. Issue one-line summaries elsewhere (#862, #867, #686, #695, #572, #424, #504, #629, #291, #515, #669, #403, #922) are **from the discovery sweep's issue reading — cited so you can check, not re-fetched here**. The "17/31 packages zero tests" figure is owned (and kept current) by `crouton-validation-reality`, not here.

Volatile facts — re-verify before relying:

| Fact | Re-check |
|---|---|
| #1036/#1037 still open (Front 1 prerequisite) | GitHub MCP `issue_read` 1036/1037, or the issue URLs |
| #983 still the live Front-2 experiment | `issue_read` 983 + `crouton-graduation-campaign` (it re-verifies its own state) |
| No `spec.json` under `pocs/` yet | `find pocs -maxdepth 2 -name spec.json` |
| Viability target widths still `[1280, 768]` | `grep -n DEFAULT_TARGET_WIDTHS packages/crouton-layout/app/utils/layout-compose.ts` |
| CLI sizing-mirror drift hazard still open | `grep -n "Keep in sync" packages/crouton-cli/lib/compose-layout.ts` |
| routing.json CI-loop model still unpinned | `python3 -c "import json;print(json.load(open('.claude/routing.json'))['_known_gaps'])"` |
| Latest measurement record | `tail -1 writeups/loop-station/history.jsonl` (mind the tokenizer field) |

If a front produces (or falsifies) a result: update the status labels here, record the evidence on the relevant issue first, and keep this skill an index — the mechanics stay owned by the skills it defers to. New-skill registration (this file's `META` entry in `scripts/gen-skills-doc.mjs` + the root CLAUDE.md artifacts table) follows the repo's normal skill-add flow.
