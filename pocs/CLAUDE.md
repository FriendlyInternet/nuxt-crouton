# pocs/ — the package incubator

This folder holds **real, working crouton Nuxt apps that double as proving grounds for new packages.**

## The idea

New crouton capabilities are not designed as packages up front. They start life as
ordinary feature code **inside a real app here** — built against a concrete use case,
with real data, real UI, real deploys. Only once a capability is *proven in an app*
(it works, the API has settled, the pattern is worth reusing) do we **extract it into
a `packages/@fyit/crouton-*` layer** and have apps consume it from there.

```
build it in a poc app  →  prove it against a real use case  →  extract into packages/  →  apps/ consume the package
```

So a poc is allowed to contain code that *will eventually live in a package* but
doesn't yet. That's the point. The messiness is intentional — it's where we learn the
right shape before committing to a shared API.

## How pocs differ from the rest of the monorepo

| | `pocs/` | `apps/` | `fixtures/` |
|---|---|---|---|
| Purpose | Incubate + prove new packages | Maintained production apps | e2e smoke harness |
| Stability | Experimental, churny | Production rigor | Throwaway, generated |
| Package code | May hold *pre-extraction* feature code | Only consumes packages | Only consumes packages |
| CI / deploy / issue rigor | Looser | Full (see root `CLAUDE.md`) | N/A |

## Working in here

- **Scaffold a new POC with ONE command — `crouton init <name> --poc`.** It scaffolds into
  `pocs/<name>` and runs the full pipeline (scaffold → generate → doctor → summary). Don't
  reverse-engineer the CLI from `crouton-cli/lib/*` — that's the #1213/#1223 30-min timeout. Add
  `--features a,b,c` / `--theme <t>` / `-d sqlite|pg` as needed; `--dry-run` to preview. (Details:
  the `crouton` skill → "Scaffold a NEW app or POC".)
- A poc may legitimately contain feature code destined for a package — that's not a
  layering violation here the way it would be in `apps/`. The `packages/` hard gate
  still applies to actual `packages/` edits; building the *precursor* inside a poc is
  how we avoid premature package changes.
- These apps are **not held to the production CI / two-domain deploy / issue-first
  standards** that `apps/` are. Treat them as experiments.
- When a capability graduates, the extraction into `packages/` **is** real package
  work — follow the normal package rules (issue first, approval gate, `pnpm typecheck`
  across apps) at that point.

## Keep a living `HANDOFF.md` — capture decisions as you go

**A POC that's actively iterating toward graduation MUST keep a living `<poc>/HANDOFF.md`,
curated to *current truth*.** Don't write the handoff from scratch at graduation — build it as
you go, so it's already done when you call the **`graduate`** skill (which consumes it as its
handoff brief).

The rule of thumb, every working session:

- **A design decision gets signed off ("ok, this works") → write it into `HANDOFF.md`.** That's
  the trigger. Not "later", not "at the end" — at sign-off, while it's fresh.
- **We iterate *past* a decision → edit/delete the superseded version.** `HANDOFF.md` is *not* a
  changelog. It must always read as *"this is how it should be built,"* never *"here's everything
  we tried." A stale learning left in is worse than no doc — it misleads the handoff.
- **What belongs:** what it is, the architecture/data model, the signed-off design decisions
  (current truth), gotchas/limitations, and the **graduation requirements** (what must hold in the
  real package + app). Descriptive, not imperative — it's a brief, not agent instructions.
- **Keep the `README.md` thin:** usage / dev / deploy + a pointer to `HANDOFF.md`. Design decisions
  live in *one* place (`HANDOFF.md`) so they don't drift.

`pocs/crouton-builder-demo/HANDOFF.md` is the worked example. (Apps that never graduate — pure
consumer demos — don't need one; this is for POCs incubating a future package.)

**Pair it with a chronological decision log (`changelog.json`).** Where `HANDOFF.md` is the *curated
current truth* (pruned), a per-POC `changelog.json` is the *append-only history* — one entry per
iteration `{ v, note, commit }`, newest first — recording **how** we got here (every signed-off
change + its commit). The two complement each other: the changelog never prunes, the handoff always
does. Surface it in-app where it's verifiable on the deployed preview (the builder POC shows a `vNN`
chip that opens the changelog; an entry's `commit` is backfilled when the next entry is added, since
the hash isn't known until push). `pocs/crouton-builder-demo/app/spike-changelog.json` is the example.

**At handoff, the doc is reconciled against the running POC — both directions.** The `graduate`
skill's reconcile gate (step 1.5) drives the live app and sorts behaviour into *confirmed /
contradicted / undocumented*, so the brief is proven complete — the **undocumented** bucket is what
catches the unknown-unknowns a checklist can't. The running POC is the visual ground truth (no
screenshot layer needed); stable `data-testid`/`data-handoff` hooks added during that pass are the
shared vocabulary the doc, the agent, and the derived tests target, and they carry into the rebuild.

## Capture the spec ledger — the behaviour contract (`<poc>/spec.json`)

`HANDOFF.md` is prose (great for *architecture*, can't be walked entry-by-entry) and `changelog.json`
is chronological (great for *archaeology*, not a contract). The missing third leg is the **spec
ledger** — an enumerated, structured list of the POC's *signed-off behaviours*, one entry each. This
is the artifact **graduation freezes as authoritative** and the **side-by-side comparison gate walks**
(the `graduate` skill, stage A0/C1). Without it, "rebuild the experience" has no checkable contract,
and the rebuild drifts into a different UX (#988).

**The trigger is the same as the handoff's: a behaviour gets signed off ("ok, this works") → write a
spec entry, at sign-off, while it's fresh.** Where the handoff captures the *decision* in prose, the
spec captures the *behaviour* as a testable contract. Both happen at the same moment.

**Schema** — `<poc>/spec.json`, an array of entries (newest edits win; specs evolve like the handoff,
not append-only like the changelog):

```json
[
  {
    "id": "drop-beside-pane",
    "behaviour": "Drop a block beside a pane inside a composed layout",
    "when": "drag a block over a composed layout and release near one edge of the pane under the pointer",
    "expect": "the block lands on the side nearest the pointer; it flattens into the row when that side runs along the row's axis, else wraps the pane perpendicular",
    "hook": "ghost-pane[data-edge]",
    "howToTest": "1. open a board with a composed card  2. drag the Chart block over the artists pane  3. release near its right edge → chart lands to the right of the pane",
    "status": "settled",
    "signedOff": "lgtm v50",
    "supersedes": "insert-between-seams",
    "consideredRejected": ["between-seams-only insert → ❌ couldn't add beside a pane with no pre-existing seam"]
  }
]
```

| Field | What it carries |
|---|---|
| `id` | stable slug — the **walk reference** and the `lgtm <id>` target the done-rule derives from |
| `behaviour` | one-line title |
| `when` → `expect` | the **testable assertion** — the contract; this is what the rebuild must satisfy and the C1 walk checks |
| `hook` | the `data-handoff`/`data-testid` selector that locates this state on **both** POC and app, so the same walk runs on each (plant it during the reconcile pass) |
| `howToTest` | numbered steps with before/after — a human can run it without reading code |
| `status` | `settled` = the contract, **preserve** · `stopgap` = known-temporary fake, **replace** with the real crouton thing at graduation (an expected C1 diff, not a bug) · `new` = an **addition** the app needs that the POC left open (a POC is a floor, not a ceiling) — no POC expected-result, so it's signed off through its own new-behaviour gate, *not* the side-by-side comparison |
| `signedOff` | the recorded sign-off token (`lgtm vNN` / comment ref) — **done is derived from this, never self-asserted** |
| `supersedes` | `id` of the entry this replaces (specs are pruned/edited, like `HANDOFF.md`) |
| `consideredRejected` | `option → ❌ why not` — stops future-us re-litigating a settled call |

**Surface it in-app like the changelog** (a chip/panel on the deployed preview) so a reviewer can walk
and sign off entries against the running POC — the spec is the *walk script*, the live POC is the
*expected result*. A reconstructed-after-the-fact ledger can't be certified exhaustive, which is the
whole reason to capture at sign-off rather than rebuild it at graduation (the retrofit path in the
`graduate` skill is the lossy fallback, not the goal). `pocs/crouton-builder-demo` is the POC the
convention will first be retrofitted onto.

**Enforced (#992 WS5):** a `PreToolUse` hook (`.claude/hooks/gate-spec-signoff.mjs`) blocks any
edit that flips an entry to `status: "settled"` without a populated `signedOff` — so "done" can't be
self-asserted by editing one word. Until a human signs off, an entry stays `stopgap`/`new`.

## What lives here right now

A mix of two things:

1. **Crouton consumer apps** — real/client-ish Nuxt apps (assets, pages, maps, i18n,
   three, email, PDF/signature flows, etc.) that exercise packages and surface gaps.
2. **The ThinkGraph stack** — an experimental canvas/agent project: a Nuxt app, a Node
   Pi-agent worker, and a Yjs collab Cloudflare Worker.

Each app carries its own `crouton.config.js`, `schemas/`, layers and `wrangler.*` —
look there for per-app specifics rather than enumerating them here.