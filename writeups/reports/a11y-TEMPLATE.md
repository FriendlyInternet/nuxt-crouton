<!--
  A11y report template (epic #726, WS4). The a11y-daily.yml sweep (and the /a11y
  skill on a deep run) writes one report per run to:
      writeups/reports/a11y-<scope-slug>-YYYYMMDD.md
  Copy this structure. <scope-slug> is "repo" for a whole-repo sweep, else a
  path-derived slug (e.g. "apps-velo", "pkg-crouton-sales").
  This file is the format reference — it is NOT itself a report. Keep it.
-->

# ♿ A11y report — `<scope>`

- **Scope:** `<repo | path>`
- **Depth:** `<quick | standard | deep>`
- **Date:** `YYYY-MM-DD`
- **Commit:** `<short SHA>`
- **Run by:** `<interactive /a11y | CI a11y.yml | daily a11y-daily.yml>`
- **Engines:** `eslint-plugin-vuejs-accessibility` (static) · `@axe-core/playwright` (runtime, deep)

## Summary

| Severity | Confirmed | Suspected |
|----------|-----------|-----------|
| 🔴 Critical | 0 | 0 |
| 🟡 Warning | 0 | 0 |
| 🔵 Note | 0 | 0 |

> One-line verdict: `<e.g. "No critical findings — 3 warnings on hand-rolled ARIA in crouton-sales." >`
> **Filed:** `<links to any a11y issues opened for confirmed criticals, or "none">`

<!--
  Per-finding sections follow, grouped by severity (highest first). Drop any empty
  group. "confidence: confirmed" means an engine flagged it (eslint rule fired, or
  axe reported it against a live DOM); "suspected" means reasoned from the template
  but not engine-confirmed. ONLY confirmed criticals become issues.
-->

## 🔴 Critical

### `<short finding title>`
- **Severity:** critical
- **Confidence:** `<confirmed | suspected>`
- **Location:** `path/to/Component.vue:NN`
- **Rule:** `<vuejs-accessibility/… | axe rule id>`
- **Who it hurts:** `<screen-reader / keyboard / low-vision user — and how>`
- **Fix:** `<the exact attribute/element to add — e.g. "add aria-label to the icon-only delete button">`

## 🟡 Warning

### `<short finding title>`
- **Severity:** warning
- **Confidence:** `<confirmed | suspected>`
- **Location:** `path/to/Component.vue:NN`
- **Rule:** `<…>`
- **Who it hurts:** `<…>`
- **Fix:** `<…>`

## 🔵 Note

- `<one-line polish note>` — `path/to/Component.vue:NN` (`<rule>`)

## Out of scope / not checked

- `<anything the depth/scope deliberately skipped — e.g. color-contrast (theme-level, tracked separately), the shared-shell baseline (#735), so the next run knows>`
