# lean-check design — why it stays report-only (#2190)

`scripts/lean-check.mjs` surfaces the two dead-code shapes a JS import graph (and so
`fallow-audit`) structurally **cannot** see:

1. an **i18n key** in `**/i18n/locales/*.json` whose last static `t('<key>')` / `$t('<key>')`
   caller was removed in the diff, and that no surviving source still calls;
2. a **Nuxt page** under `app/pages/**` whose only inbound link (`to="/x"`, `navigateTo('/x')`,
   `href="/x"`) was removed in the diff, and that no surviving source still references.

The live miss it prevents is **#2186 / PR #2187**: a removed button was the last caller of
`sales.events.openPos` and the last link to the `/order` page, leaving both dead — invisible to
fallow because neither is a JS import.

## Corpus count (sizing the whole-repo candidate surface)

`node scripts/lean-check.mjs --corpus` on `main`:

```
lean-check (corpus) — report-only, never blocks (#2190)
  scanned: 50 locale file(s) · 2434 defined key(s) · 3391 source file(s) · 121 page file(s)

  Orphaned i18n keys: 637
  Stranded Nuxt pages: 0
```

**637 defined i18n keys** in the repo have no surviving static `t()`/`$t()` caller. That number
is the reason this check can only ever be **report-only**.

## Why it stays report-only (never blocks, always exits 0)

The corpus number makes the case by itself: 637 keys is far too noisy a signal to gate a build on,
and the count is **not** 637 genuine dead keys. The static scan cannot see the legitimate ways a
key is reached without a literal `t('a.b')`:

- **runtime-composed keys** — `t(prefix + '.title')`, `` t(`bookings.${status}`) `` — the
  static prefix guards (#1957) suppress the ones we *can* recover, but not every dynamic shape;
- **keys consumed outside `.vue`/`.ts`/`.js`** — a manifest, a generated column def, a server
  template, an email renderer;
- **keys read by a package** a consuming app inherits, where the caller lives in `dist`.

Blocking on any of these would refuse correct code — exactly the *authoring-a-gate* failure
AGENTS.md warns about (run the rule over the corpus, not just its tests). So the design contract is:

- **Report-only — ALWAYS exits 0.** It never blocks, never auto-deletes. Even an uncaught crash is
  caught and exits 0 (a leanness *hint* must never be the thing that reddens CI).
- **Diff-scoped by default** (`--base <ref>`). In the diff mode that a worker actually runs, the
  candidate set is only what *this diff* orphaned — on a clean tree that is **0**, and on the #2186
  diff it is exactly `sales.events.openPos` + `/order`. The 637 is a whole-repo *backlog* sizing,
  not the per-change signal.
- **#1957 false-positive guards** — a key reached via a recoverable dynamic prefix
  (`t('a.b.' + x)` / template literal) is not flagged; a page whose route is still referenced
  anywhere is not flagged; an all-dynamic route (`/[id]`) is skipped.
- **No silent no-op** — it always prints what it scanned (locale files, defined keys, source
  files, page files), and warns when a glob matched nothing, so a mis-pathed scan can't masquerade
  as "clean".

## How it's used

The worker runs `node scripts/lean-check.mjs --base origin/main` on its diff. A candidate is a
*prompt*, not a verdict: remove the now-dead key/page, **or** state on the PR why it stays. This is
the machine half of the "remove what you orphan" rule (AGENTS.md *Working style* / CLAUDE.md *Core
Principles* / the evidenced worker step in `.claude/agents/task-worker.md`).
