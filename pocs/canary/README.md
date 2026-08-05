# `pocs/canary` — the worker pipeline's crash-test dummy

**Nothing in this folder is real, and nothing in it is worth protecting.** It exists so the canary
rig (#1878) can point fixed, re-runnable tickets at code an agent may freely change, break, and
change back — instead of at code someone depends on.

If you found this folder because something here looks wrong, that is probably the point. Check
[`.github/canaries.json`](../../.github/canaries.json) before "fixing" it.

## Why it isn't a Nuxt app

Every other `pocs/*` entry is a generated crouton app. This one is a bare `tsc --noEmit` package,
on purpose.

The acceptance gate typechecks the app a run touched, and it deliberately returns **NEUTRAL** —
not pass, not fail — when a fresh poc's Nuxt auto-imports are unresolved, because `nuxt prepare`
may not have run in that environment (#1863/#1869). That protection is correct for real work and
fatal for a canary: `acceptance-red` asserts `acceptance: FAILED`, and a NEUTRAL verdict would
make it fail for a reason that has nothing to do with the thing it is testing. A canary whose
result depends on whether a build step happened to run is not a canary.

`tsc --noEmit` over three tiny files is deterministic, sub-second, and has no auto-import concept
at all — so pass means pass and fail means fail.

## Why it's in `pocs/` and not `fixtures/`

Not a preference — a constraint. The acceptance gate resolves the touched app with
`/^(apps|pocs)\/([^/]+)\//` (`planAcceptance` in [`scripts/pi-finish.mjs`](../../scripts/pi-finish.mjs)).
A `fixtures/` path matches nothing, so `APP_DIR` is null, so acceptance never runs, so both
acceptance canaries would be permanently neutral. `apps/` is for launched apps with a production
counterpart. That leaves `pocs/` — which is also the right meaning: the safe-to-fail incubator.

## What each file is for

| Path | Canary | Why it's shaped this way |
|---|---|---|
| `src/greeting.ts` | `app-acceptance-pass`, `acceptance-red` | `Locale` is a tight union, not `string`, so adding a locale without widening it is a **genuine** type error. A staged failure would prove nothing. |
| `i18n/{nl,en,fr}.json` | `packages-locale-3-files` | Exactly three files, so the run can assert "3 in, 3 out" — the [#1876](https://github.com/FriendlyInternet/nuxt-crouton/issues/1876) dropped-last-file bug. `nl.json` is asserted by name because in #1874 the dropped file was the only one that mattered. |
| `package.json` | `app-acceptance-pass` | Needs a `name` and a `typecheck` script — the gate skips to NEUTRAL without both. No `postinstall`: not a Nuxt app, so there is nothing to prepare and nothing to break a monorepo-wide install. |

## Rules

- **Never deploy it.** No `cf:*` scripts, no `deploy.config.json`, no `wrangler.jsonc` — by design.
- **Never import it** from an app, a package, or another poc. It has no consumers and must keep none.
- **Don't add real features.** If you want somewhere to try an idea, scaffold your own poc.
- **Do expect churn.** Canary branches are closed and deleted on each dispatch, so a worker's
  changes here are thrown away rather than merged. `main` should always show the state above.
