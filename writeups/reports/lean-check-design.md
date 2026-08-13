# lean-check design notes (#2190)

`scripts/lean-check.mjs` is the report-first "keep it lean" check. It flags **net-new orphans** a
change introduces that the `fallow-audit` gate (#1120) structurally can't see, because they sit
outside a JS import graph:

- an **orphaned i18n key** — a key defined in `**/i18n/locales/*.json` whose last `t('<key>')` /
  `$t('<key>')` caller was deleted in the diff (JSON locale keys aren't fallow dependencies);
- a **stranded Nuxt page** — an `app/pages/**` (or `pages/**`) route file whose only inbound link
  was removed in the diff (a page is an auto-registered *entry point*, so a static importer graph
  never calls it "dead").

This is the concrete crouton implementation of the AGENTS.md **"Remove what you orphan"** rule.

## Usage

```bash
node scripts/lean-check.mjs --base origin/main   # diff-scoped: what did THIS change orphan?
node scripts/lean-check.mjs --corpus             # whole-repo: how many candidates exist today?
```

`--base` defaults to `$LEAN_CHECK_BASE`, else the merge-base with `origin/main`, else the working
tree vs `HEAD`. It always prints what it scanned (locale files, defined keys, source files, page
files, diff lines) so a mis-globbed path can't "pass" by silently finding nothing (AGENTS.md
*Authoring a gate* → no silent no-op).

## Design constraints honoured (AGENTS.md "Authoring a gate")

- **Report-only. It always exits 0 — it never blocks and never auto-deletes.** A zero-reference
  finding is a **hypothesis** (#1149), not a verdict: a human/agent rules out the dynamic loader
  before removing the callee. Even an uncaught crash exits 0, so a bug in the check can't wedge CI.
- **Corpus-first (the #1965 contract).** The rule was run over the whole repo *before* it is
  allowed to warn on a diff — see the corpus baseline below. Every candidate it lists is a claim a
  human must defend, not code to delete.
- **#1957 false-refusal guards** are built in and unit-tested (`scripts/lean-check.test.mjs`):
  - an i18n key reached only via a **dynamic key** — `t('sales.events.' + status)` or
    `` t(`a.b.${x}`) `` — is **not** reported (the surviving namespace prefix covers it);
  - a page whose terminal route segment is **still referenced anywhere** in source (a string-built
    `NuxtLink`/redirect) is **not** reported;
  - an all-dynamic route (`[slug]/[id]`) is conservatively skipped — too fuzzy to match a link
    string, so it is never flagged.

## Corpus baseline (whole-repo `--corpus` run)

```
[lean-check] corpus (whole-repo)
[lean-check] scanned: 50 locale file(s), 2434 defined key(s), 3583 source file(s), 132 page file(s)
[lean-check] dynamic i18n prefixes in use (not dead): 8
🔎 637 candidate orphaned i18n key(s) — a HYPOTHESIS (#1149), not a verdict.
```

**Why 637 candidates, and why this is report-only for now.** The corpus already holds hundreds of
defined-but-un-`t()`'d keys. They are dominated by:

- **package-owned locale bundles** (`packages/crouton-auth|admin|bookings|assets/i18n/locales/*`) —
  a package ships keys its *consuming apps* reference, and a consuming app's `t(...)` call lives in
  generated/app code the package's own scan doesn't see. These are **not dead** from the package's
  point of view;
- **`retired/` and `pocs/` bundles** — parked/experimental code where dead keys are expected;
- keys reached through **crouton's own indirection** — `useFormatCollections()`, component props
  that forward a key string, and layout/registry lookups — which a plain `t('literal')` grep misses.

Because a whole-repo warning would be ~637 lines of mostly-legitimate keys, the check is **diff-
scoped by default** (`findOrphanKeys` / `findStrandedPages` only consider what the *current diff*
removed) and the `--corpus` mode exists purely to *size* the false-positive surface. **It must not
move toward blocking** until that corpus number is understood and the package-key / indirection
cases are handled (e.g. a cross-app reference index, or an allowlist of package-published prefixes).
Diff-scoped mode does not suffer this: it only fires when a caller was actually deleted in the diff.

## Regression check (#2186)

The live miss on #2186 / PR #2187 — the "Kassa openen" button removed but its `sales.events.openPos`
key and `/order` page left behind — is covered by `scripts/lean-check.test.mjs`:

- the deleted `t('sales.events.openPos')` caller with the key still defined and no surviving dynamic
  `sales.events.` prefix ⇒ `findOrphanKeys` surfaces `sales.events.openPos`;
- the removed link to `/order` with no other reference to the `order` segment ⇒ `findStrandedPages`
  surfaces the `[slug]/order.vue` page;
- the dynamic-key counterpart (`t('sales.events.' + status)` still present) ⇒ **not** flagged.

## Where the rule lives

- **Principle:** AGENTS.md → *Working style → Remove what you orphan* (method) and CLAUDE.md →
  *Core Principles → Remove What You Orphan* (crouton adapter).
- **Evidenced worker step:** `.claude/agents/task-worker.md` requires the run-record to state what
  was removed with a deleted caller, or "nothing orphaned" + the proving grep — enforced, not an
  optional checkbox.
- **Tool:** `scripts/lean-check.mjs` (+ `scripts/lean-check.test.mjs`).
