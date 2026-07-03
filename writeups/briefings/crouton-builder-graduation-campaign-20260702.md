> ⚠️ **Campaign snapshot (2026-07-02) for the live #983 builder graduation — non-authoritative and fast-decaying** (#504). Originally authored as a skill in PR #1091 (epic #1073); relocated here because a live issue's battle state belongs on the issue/briefing, not in a trigger-loaded skill (a stale campaign skill actively misleads). The graduation *method* is owned by the `graduate`/`spec`/`conformance` skills. When #983 closes with a postmortem, this file is history.


# Crouton Graduation Campaign — finish #983 under the #992 spec-driven loop

One purpose: let a fresh session pick up the repo's hardest live problem — rebuilding the Crouton
Builder app the crouton way — without re-fighting any battle that is already settled and recorded.

## When to use / when NOT to use

| Situation | Use |
|---|---|
| Working #983, #988, or anything labelled `poc:crouton-builder` | **this skill** (the live-case map), then the skills below for mechanics |
| Generic "graduate any POC" mechanics (stages A0–C2, buckets) | `graduate` skill — it owns the method; do not restate it |
| Capturing one spec entry into `<poc>/spec.json` | `spec` skill (schema owned by `pocs/CLAUDE.md`) |
| Running the C2 crouton-native checklist | `conformance` skill |
| Why the done-rule/spec machinery exists at all (case law) | `crouton-failure-archaeology` sibling |
| Which gate fires for a given change, approval semantics | `crouton-change-control` sibling |
| Schema JSON format, what `crouton config` generates | `crouton-generation-reference` sibling |
| LayoutTree / blocks / viability theory | `crouton-layout-reference` sibling |

This skill carries only the **delta**: the verified state of the live case, the sequencing, the
choices, and the fences.

---

## 0. Situation (facts verified 2026-07-02 — refresh before acting, §Provenance)

**Vocabulary.** A *POC* is an incubator app under `pocs/` (safe-to-fail; stage `poc` per
`harness.config.mjs`, resolver `node scripts/harness-stages.mjs <path>`). *Graduation* is the
deliberate rebuild of a proven POC into real `packages/*` + a consuming app (the `graduate` skill).
The *spec ledger* is `<poc>/spec.json` — the enumerated, signed-off behaviour contract graduation
freezes as authoritative.

### The cast

| Actor | What it is | State verified 2026-07-02 |
|---|---|---|
| [#983](https://github.com/FriendlyInternet/nuxt-crouton/issues/983) | The graduation epic: builder POC → `crouton-layout` package + builder app | **Open**, `status:in-progress` + `delegate`. Last comment 2026-06-30: the WS5 reset lesson (below). Package side (#985/#986/#987/#974) merged to `main` and **stays** |
| [#988](https://github.com/FriendlyInternet/nuxt-crouton/issues/988) | WS5 — the consuming builder app | **Open**, `status:in-progress`. ⚠️ Its last comment (2026-06-29, "🚀 Live: crouton-builder.pmcp.dev") **predates the reset** — reading #988 alone makes v1 look done. The reset record lives on **#983's** thread only |
| [PR #991](https://github.com/FriendlyInternet/nuxt-crouton/pull/991) | v1 app's staging-deploy wiring | **Closed unmerged** 2026-06-30. Its wrangler/deploy wiring never reached `main` |
| [#992](https://github.com/FriendlyInternet/nuxt-crouton/issues/992) | The method epic born from the failure ("Tighten the POC→app graduation loop, spec-driven") | **Open**, `status:ready-to-close`; postmortem posted 2026-07-02, awaiting a human `/close-epic`. Its postmortem: "**Track 2 (#983) is the acceptance gate for #992, not a follow-on**" |
| `pocs/crouton-builder-demo/` | **The POC** (the spike, epic #905; HANDOFF.md v11→v52 — NB `HANDOFF.md:9` itself misstates "epic #907", which is a closed *sub-issue* of #905; the issue record wins over the app doc) | On disk + on `main`. Has `HANDOFF.md` (incl. "🎓 Graduation requirements" + "🔖 Stable element hooks" sections), `app/spike-changelog.json` (newest v52), `schemas/pages.json`, `deploy.config.json` → staging `https://crouton-builder-demo.pmcp.dev` (URL unreachable from this sandbox — human-verifiable only) |
| `pocs/crouton-builder/` | **The disavowed v1 app** (commit `a375f41`, an ancestor of `origin/main`) | On disk. Has NO `server/db/schema.ts`, no generated collections/layers, no `wrangler.jsonc`. Its README claims "Rebuilt clean … (not ported)" — **that claim is the self-asserted confidence that lied**; the #983 reset comment contradicts it. Trust the issue record over the app's README (`crouton-docs-trust-map`) |
| `writeups/briefings/crouton-builder-graduation-brief.md` | The cold-readable graduation brief (on `main`) | Exists; backbone = the HANDOFF; per-unit shape calls + test checklist |
| Tag `graduation-v1-reserve` | The parked v1 work (#989 + #990) | **Not fetched in this shallow clone** (`git tag` is empty). Exists per #992 body — unverified locally. Pre-graduation base = `b093d4c` (present locally) |
| `https://crouton-builder.pmcp.dev` | The v1 app's staging Worker (deployed 2026-06-29 off PR #991) | Serves the **disavowed** v1 (unverified — sandbox can't reach `*.pmcp.dev`). Not evidence of progress |

**Spec machinery status:** `**/spec.json` under `pocs/` → **zero files** (verified by glob + find,
2026-07-02). The `/spec` ledger, the `gate-spec-signoff.mjs` hook, and `/conformance` have **never
been exercised in anger**. This campaign is their first real run (see §5).

### The #988 sins (verbatim from the reset comment on #983, 2026-06-30)

1. **"Ported the POC** — copied `spike-*` components/utils into the app for 'stability'. … The skill
   already said *don't port*; I deviated under time pressure. Wrong call."
2. **"Hand-assembled the app** (mirrored a fixture by hand) instead of scaffolding via the CLI — so it
   was missing standard scaffold files. The killer: no `server/db/schema.ts` … → the app **built green
   but 500'd at runtime on every request**."
3. **"No real collections** — backend-free demo blocks, not the actual data model the builder exists
   to arrange."

Green build, clean typecheck, live deploy URL, and agent confidence were **all true while the work
was wrong**. That is why "done" is now *derived from a recorded sign-off* (AGENTS.md done-rule).

### One recorded ambiguity (name it, don't silently resolve it)

#992's Track 2 says restart "from the pre-graduation point (`b093d4c`)" with v1 (#989 + #990)
"re-merged piece-by-piece as the spec validates each"; #983's reset comment says "Scope of the
reset: **only WS5/#988 (the app)**. The package graduation (#985 #986 #987 #974, merged) stays."
Reality on `main` matches the reset comment: `packages/crouton-layout` is merged (with the
`layout-serialize`/`layout-ticket` exports; "266 tests green" per #983 — reported, not re-run here)
**and** the v1 app directory is also still on `main`. Working interpretation: **packages = keep;
app = rebuild from A0; the on-disk v1 dir is residue, not a base.** If in doubt, ask the owner —
the issue record beats any app README; the full doc trust order is `crouton-docs-trust-map` §1.

---

## 1. The phases (numbered, decision-gated)

Stage names A0–A4 / B / C1 / C2 are the `graduate` skill's vocabulary — it owns their full
definitions. Below is only their instantiation for this case. Every "sign-off" is a **reply comment
containing `lgtm`/`approve`** (#572 — reactions and labels do nothing).

### Phase 0 — Re-situate (every fresh session)

```bash
# On-disk truth
ls pocs/crouton-builder-demo pocs/crouton-builder
find pocs -maxdepth 2 -name spec.json          # expect: nothing until A0 is done
test -f pocs/crouton-builder/server/db/schema.ts && echo present || echo "MISSING (v1 residue confirmed)"
```

Then read the **live** state via GitHub MCP (`gh` CLI is absent in this env): `issue_read` #983
(`get` + `get_comments`), #988, #992. Expected as of 2026-07-02: the table above. **If #992 is now
closed** → fine, the method is locked; proceed. **If #988/#983 carry comments newer than
2026-06-30** → someone advanced the campaign; reconcile before acting (search-before-create — never
mint a duplicate epic; the work lives under #983).

### Phase A0 — Freeze the spec (the first real move)

The ledger is empty (verified), so this is the **retrofit path** (`graduate` A0): retro-capture the
already-signed-off behaviours into `pocs/crouton-builder-demo/spec.json` via the `spec` skill.

Sources to draft from (all on `main`): `pocs/crouton-builder-demo/HANDOFF.md` ("Signed-off design
decisions" + "Board gestures" + "🎓 Graduation requirements"), `app/spike-changelog.json` (v-entries
= the sign-off moments), and the five `data-handoff` hooks named in HANDOFF's "🔖 Stable element
hooks" table (`page-badge` · `region-pill[data-region]` · `floor-readout` · `snap-guide[data-armed]`
· `ghost-pane`) — those become each entry's `hook`.

**Hard constraint (enforced, verified 2026-07-02):** `.claude/hooks/gate-spec-signoff.mjs` blocks
(exit 2) any edit that leaves a `status: "settled"` entry without a populated `signedOff`. So the
retro-captured entries land as `stopgap`/`new`/unsettled drafts, and flip to `settled` **only when
the human signs each off** (`lgtm <id>`). You cannot route around this by editing — that is the
point. Self-test the gate any time:

```bash
echo '{"tool_input":{"file_path":"pocs/x/spec.json","content":"[{\"id\":\"a\",\"status\":\"settled\"}]"}}' \
  | node .claude/hooks/gate-spec-signoff.mjs; echo "exit=$?"   # expect: Blocked …, exit=2
```

Validate the ledger with the `spec` skill's `node -e` check. **Expected exit state:** a committed
`spec.json` whose `settled` entries all carry a recorded sign-off. **If the owner won't walk the
POC to sign off** → entries stay unsettled and C1 later leans harder on the live side-by-side
(the `graduate` skill's stated fallback); do NOT quietly promote drafts to `settled`.

### Phase A1 — Reconcile against the running POC (human-driven)

The POC runs at `https://crouton-builder-demo.pmcp.dev` (per its `deploy.config.json`; sandbox
cannot reach it). Per `graduate` A1: the human drives, you draft and reconcile
confirmed / contradicted / undocumented. The undocumented bucket is where retro-capture's losses
surface — expect to add entries here.

### Phase A2 — Revision plan: bucket every behaviour (sign-off gate)

Sort each spec entry into **Preserve / Replace / Add** (`graduate` A2 owns the definitions). Known
Replace candidates for this case, from the reset comment and PR #991's own body: backend-free demo
blocks → real collections; migrations copied from the demo POC → regenerated build-first
(`db-migrations` skill owns that gotcha); `useState`-held layout doc → persisted `layout_configs`.
Known Add candidates: auth/team scope, empty/error/loading states — the POC deliberately faked them.

### Phase A3 — Data model: real collections (sign-off gate)

**Which collections the builder app actually manages is an open owner decision** — the reset
comment only says "Generate real collections; the builder arranges *those* blocks". Propose, then
route through `schema-review` (#314) before generating. Reference: `crouton-generation-reference`.

### Phase A4 — Walking skeleton (checkpoint — kills the #988 class early)

Scaffold with the CLI, never by hand. Verified: the `crouton` bin has an `init` subcommand
("Create a new crouton app end-to-end (scaffold → generate → doctor → summary)",
`packages/crouton-cli/bin/crouton-generate.js`). Deploy wiring via the `poc-deploy` skill
(`pnpm poc:scaffold-deploy` exists in root `package.json`; `.github/workflows/deploy-pocs.yml`
exists) — PR #991's wiring died with the PR, so this is redone, not resumed.

**Expected observations before building ANY behaviour** (these are the exact structural checks
`/conformance` will re-run at C2 — compare `apps/velo`, which passes all of them):

```bash
test -f pocs/crouton-builder/server/db/schema.ts && echo ok || echo "STOP: the #988 500"
grep -q 'nuxt prepare 2>/dev/null' pocs/crouton-builder/package.json && echo ok || echo "STOP: unguarded postinstall"
ls pocs/crouton-builder/layers/ 2>/dev/null   # generated collection layers, not stubs
```

Deploy and confirm it **boots and serves a request** (a human or CI smoke — not a green build).
**If it 500s at runtime** → `crouton-diagnostics-index` sibling, then `bug-archaeology` before any
fix. **Tag a checkpoint** when it boots (the `graduate` skill's instruction).

### Phase B — Build to satisfy the spec

Per `graduate` Stage B: survey `packages/crouton-layout` FIRST (it already exports the editable
renderer, serialisation, ticket codec — the app **consumes**, never re-derives; the #983 WS4
lesson). Hand-written `packages/*` logic → `test-review` (#774); the `packages/` edit gate applies
(`crouton-change-control`). Reproduce the five `data-handoff` hooks **verbatim** so the C1 walk
runs identically on POC and app.

### Phase C1 — Experience side-by-side (sign-off gate)

POC (`crouton-builder-demo.pmcp.dev`) and rebuilt app open together; walk Preserve + Replace
entries per the `graduate` C1 definition. Passes at **zero unexplained differences**, each entry
`lgtm <id>`-signed. Human-driven (sandbox can't reach either URL).

### Phase C2 — Conformance gate → promotion

Run the `conformance` skill against the app (it owns the checklist; holds on `status:blocked` on
the graduation PR). Promotion (`pocs/crouton-builder` → `apps/`) only when **both** axes carry
recorded sign-offs. Then: retire what supersedes (`remove-app` — including the stale v1 Worker at
`crouton-builder.pmcp.dev` if a fresh deploy hasn't overwritten it), close #988, verify-rollup +
`postmortem` on #983, walk up to parent #905.

---

## 2. The solution menu (where genuine choices exist)

| # | Option | Obligation it carries |
|---|---|---|
| 1a | **Retro-capture the spec** from HANDOFF + changelog + hooks (the default; A0 above) | Lossy by design — lean harder on C1; nothing goes `settled` without a per-entry human `lgtm` (hook-enforced) |
| 1b | **Re-drive sign-offs live**: owner walks the running POC and signs each behaviour fresh | Higher fidelity, higher human cost; still lands in `spec.json` via the `spec` skill |
| 2a | **Rebuild in place** — `crouton init` replaces `pocs/crouton-builder`'s contents | Must first clear the v1 residue deliberately (recorded on #988), not mix scaffold + leftovers |
| 2b | **Fresh directory**, retire the v1 dir via `remove-app` | Cleaner archaeology; costs a rename at promotion. Either way the v1 dir is residue, never a base |
| 3a | **Rebuild the app 100% fresh** (default per the reset comment) | Every behaviour re-earned through the spec |
| 3b | **Re-merge v1 pieces from `graduation-v1-reserve`** as the spec validates each (per #992 Track 2) | Requires unshallowing (`git fetch --tags origin` — the local clone is shallow and the tag is absent); each re-merged piece still needs its spec entry signed off — the tag is a quarry, not a shortcut |

2a-vs-2b and 3a-vs-3b are **owner decisions** — propose on #988 and wait; don't pick silently.

## 3. Wrong paths — fenced, with evidence

| Fence | Evidence |
|---|---|
| **Porting POC files** (`cp spike-* …`, "for stability") | #988 sin 1; `graduate` Stage B: "If you catch yourself `cp`-ing POC files into the app, stop" |
| **Hand-assembling the app** (mirroring a fixture instead of `crouton init`) | #988 sin 2 — no `server/db/schema.ts` → runtime 500 on a green build; ~a session of blind debugging |
| **Trusting green build / typecheck / deploy URL / your own confidence as "done"** | All four lied at once (#988); AGENTS.md done-rule; status is derived from a recorded `lgtm` |
| **Skipping the spec ledger / flipping entries to `settled` yourself** | `gate-spec-signoff.mjs` blocks it (verified exit 2, 2026-07-02); until a human signs, it isn't settled |
| **Trusting `pocs/crouton-builder/README.md` or #988's last comment as current state** | Both are pre-reset v1 artifacts; the reset record is on #983 (2026-06-30) |
| **Hand-editing generated artifacts instead of regenerating** (e.g. copying another app's migrations forward) | PR #991 did exactly this as a stopgap ("Migrations bootstrapped from crouton-builder-demo … regenerate cleanly via build-first `db:generate`"); the build-first gotcha is the `db-migrations` skill's (#523) |
| **Working the builder under the layout-family epics** (#868/#895/#855/#905 overlap) | The live work is #983/#988 (issue archaeology, 2026-07-02); search-before-create |
| **Closing an issue with unchecked acceptance boxes** | The #994 pattern, called out in #992's own postmortem |
| **Deploying anywhere but staging** | Standing rule #318; structural, not conventional |

## 4. Validation & promotion protocol (measurable only)

Never judged by eye or by builder confidence. The app is promotable **iff**:

1. Every Preserve/Replace spec entry: walked side-by-side (C1), zero unexplained diffs, per-entry
   recorded `lgtm <id>`.
2. Every Add entry: signed off through its own gate (`schema-review` / `ui-proposal` /
   `test-review`) — not C1.
3. The `/conformance` checklist: no `❌`, no unsigned `⏳ needs-human`, and a human `lgtm` on the
   gate comment (the #310/#572 loop).
4. Checkpoint tags exist at each signed-off state (skeleton boots · each C1 group · C2 green).

Anything less is "in progress", whatever the build says.

## 5. Research-frontier note — this campaign is also an experiment

This is the **first exercise of the spec machinery** (`/spec`, `gate-spec-signoff.mjs`,
`/conformance`), and #992's postmortem explicitly makes #983 its acceptance gate. While running it,
record for the method (feed the #983 postmortem; see `crouton-research-frontier` for the evidence
bar, `crouton-harness-observability` for the measuring tools): the cost of retro-capture vs
capture-at-sign-off; what the C1 walk catches that the written spec missed (the undocumented
bucket — the metric of "the comparison is the gate, not the list"); whether `/conformance` catches
anything a green build passed; every place a proxy-for-done tried to reassert itself.

---

## Provenance and maintenance

Facts verified **2026-07-02** against: live GitHub state via MCP (`issue_read` #983/#988/#992
incl. comments; `pull_request_read` #991), the working tree on branch of `origin/main`
(`pocs/crouton-builder*` contents, `writeups/briefings/crouton-builder-graduation-brief.md`,
`packages/crouton-layout/package.json` exports, `apps/velo/server/db/schema.ts`,
`packages/crouton-cli/bin/crouton-generate.js` `init`, root `package.json` `poc:scaffold-deploy`,
`.github/workflows/deploy-pocs.yml`), a live run of `gate-spec-signoff.mjs` (blocked, exit 2), the
`harness-stages.mjs` resolver, and the `graduate`/`spec`/`conformance` SKILL.md texts (stage names
A0–A4/B/C1/C2, buckets, statuses). Marked unverified: the `graduation-v1-reserve` tag (shallow
clone, from #992), the "266 tests green" count (from #983's comment), and both `*.pmcp.dev` URLs
(sandbox egress).

Re-verify before relying on the snapshot (this section rots fastest):

```bash
find pocs -maxdepth 2 -name spec.json                    # still empty? A0 not done yet
test -f pocs/crouton-builder/server/db/schema.ts && echo rebuilt || echo "still v1 residue"
git log --oneline -3 -- pocs/crouton-builder/            # anything after a375f41 = campaign moved
```

…and re-read #983/#988/#992 via GitHub MCP (states, labels, last comments). If #983 is closed with
a postmortem, this skill is history — retire it into `crouton-failure-archaeology`.
