# i18n Translation Audit Skill

This skill performs a systematic translation completeness audit across all packages in the monorepo, using parallel subagents. It can also generate fix prompts or auto-fix individual packages.

## Trigger Phrases

Use this skill when the user mentions:
- "/i18n-audit"
- "check translations"
- "audit translations"
- "translation completeness"
- "missing translations"
- "hardcoded strings"
- "i18n audit"

---

## Project Translation Architecture

**Supported locales**: `en` (English), `nl` (Dutch), `fr` (French)
**Translation composable**: `useT()` from `crouton-i18n` — NOT raw `useI18n().t()`
**Locale file locations** (check both per package):
- `packages/{name}/i18n/locales/{locale}.json`
- `packages/{name}/locales/{locale}.json`

**Registration**: Each package registers locale files in its `nuxt.config.ts`:
```typescript
i18n: {
  locales: [
    { code: 'en', file: 'en.json' },
    { code: 'nl', file: 'nl.json' },
    { code: 'fr', file: 'fr.json' }
  ],
  langDir: '../i18n/locales'  // relative to app/ dir
}
```

**Usage patterns to scan for** (in .vue and .ts files):
- `t('key')`, `t("key")` — standard call
- `useT()` — composable import
- `tString('key')` — string-only variant
- `$t('key')` — template global
- `tContent(entity, 'field')` — entity translation

---

## Mode 1: Full Audit (default)

When invoked with no arguments or `--audit`, run a full analysis across all packages.

### Step 1 — Discover packages

Scan `packages/` to find:
- All packages with locale files (check both `i18n/locales/` and `locales/` subdirectories)
- All packages with Vue components but NO locale files

### Step 2 — Group packages for parallel agents

Group packages into batches of 2 (to balance agent load):

| Agent | Packages |
|-------|----------|
| Agent A | crouton-i18n + crouton-auth |
| Agent B | crouton-admin + crouton-assets |
| Agent C | crouton-bookings + crouton-pages |
| Agent D | crouton-sales + crouton-triage |
| Agent E | crouton-core |
| Agent F | crouton-editor + crouton-flow + crouton-collab (+ any other small packages) |

Adjust groupings based on what packages actually exist. Skip packages with no `.vue` files.

### Step 3 — Launch all agents in parallel

**CRITICAL**: Launch ALL agents in a single message (parallel tool calls). Do not launch them sequentially.

Each agent receives this analysis prompt (adapt package names):

```
Perform a translation audit for these packages: {packageA} and {packageB}

For EACH package:

## 1. Discover locale files
Check these paths (both might exist):
- /Users/pmcp/Projects/nuxt-crouton/packages/{name}/i18n/locales/en.json
- /Users/pmcp/Projects/nuxt-crouton/packages/{name}/locales/en.json
- Same for nl.json and fr.json

If no locale files exist at all, note "no locale infrastructure".

## 2. Key completeness check
Read en.json, nl.json, fr.json. Recursively flatten ALL nested keys to dot-notation
(e.g. "common.save", "auth.login.title"). Then report:
- Total key count per locale
- Keys in en that are MISSING from nl (list all)
- Keys in en that are MISSING from fr (list all)
- Keys in nl or fr that don't exist in en (orphaned — list all)

## 3. Component scan
Scan ALL .vue files under packages/{name}/app/
Find all t('...'), tString('...'), $t('...'), useT() calls.
Extract string literal keys. For each key, check if it exists in en.json.
Report: keys used in components but NOT defined in en.json.
Also note: does any component use useT()/t() at all? (yes/no)

## 4. Hardcoded text detection
Scan template sections for user-visible text NOT wrapped in t().
Focus on: button labels, headings, placeholders, aria-labels, toast messages,
empty state messages, error messages, form field labels.
Skip: CSS classes, icon names, route paths, variable interpolations.

## 5. Dead key detection
Find keys in en.json that are never referenced in any component or composable.

## Output format (use exactly this structure):

## {PackageName} Audit
### Locale Files
- en.json: exists / missing | X keys
- nl.json: exists / missing | Y keys
- fr.json: exists / missing | Z keys

### Missing from nl (X keys)
- key.path.one (add "- none" if 0)

### Missing from fr (X keys)
- key.path.one (add "- none" if 0)

### Orphaned keys
- key.path (or "none")

### Component t() usage
- Uses t()/useT(): yes/no
- Keys in components not in locale (X):
  - file.vue: 'missing.key'

### Hardcoded strings (X)
- ComponentName.vue:~LINE "The hardcoded text" (context: button/heading/etc)

### Dead locale keys (X)
- key.path (or "none")
```

### Step 4 — Compile the report

After ALL agents complete, compile their outputs into a single structured report.

Save to: `docs/reports/translation-audit-report-{YYYYMMDD}.md`

Report structure:
```markdown
# Translation Audit Report
Date: {date}
Packages audited: X
...

## Per-Package Results (one section per package)
...

## Priority Action Plan

### P0 — Critical (missing keys used in components, or no t() usage at all)
### P1 — High (hardcoded strings in user-facing components)
### P2 — Medium (missing nl/fr locales, dead keys)
### P3 — Low (packages with no locale infrastructure but also no visible UI text)

## Summary Table
| Package | en keys | nl sync | fr sync | Hardcoded | Dead keys | t() used | Priority |
|---------|---------|---------|---------|-----------|-----------|----------|----------|
```

### Step 5 — Report to user

Present the summary table and P0/P1 findings inline. Tell the user the report was saved and offer to fix specific packages.

---

## Mode 2: Fix a specific package

When invoked as `/i18n-audit --fix {package-name}`, fix that package's translation issues:

### Fix workflow

1. **Read the latest audit report** from `docs/reports/` (most recent by date)
2. **Find the package section** in the report
3. **Create a todo list** for all issues in that package:
   - Add missing keys to en.json, nl.json, fr.json
   - Wrap hardcoded strings with `useT()`
   - Remove dead keys (with confirmation)
4. **Work through each issue**:

#### Adding missing keys
```typescript
// In the locale file:
{
  "section": {
    "newKey": "English value here"  // en.json
    "newKey": "English value here"  // nl.json — mark with TODO comment nearby
    "newKey": "English value here"  // fr.json — mark with TODO comment nearby
  }
}
```

For nl.json and fr.json: use English as placeholder. Add `"_todo": true` sibling key
at the parent level to flag for human translation later. Example:
```json
{
  "section": {
    "_todo": true,
    "newKey": "English placeholder"
  }
}
```

#### Wrapping hardcoded strings
```vue
<!-- Before -->
<UButton>Save Changes</UButton>

<!-- After -->
<script setup lang="ts">
const { t } = useT()
</script>
<UButton>{{ t('common.saveChanges') }}</UButton>
```

Key naming convention: `{package}.{feature}.{action}` or use `common.*` for shared terms.

5. **Run typecheck** after fixing: `npx nuxt typecheck` from the package directory
6. **Update the audit report** — mark fixed issues

---

## Mode 3: Fix all P0 issues

When invoked as `/i18n-audit --fix-critical`, launch parallel agents to fix all P0 issues:

- Read audit report to find all P0 packages
- Launch one agent per P0 package simultaneously
- Each agent fixes: missing component keys in locale files + zero-t() packages
- Compile results, run typecheck

---

## Key Naming Conventions

| Pattern | Use case | Example |
|---------|----------|---------|
| `common.{action}` | Shared UI words | `common.save`, `common.cancel`, `common.delete` |
| `common.{noun}` | Shared nouns | `common.loading`, `common.error`, `common.success` |
| `{package}.{noun}.{descriptor}` | Package-specific | `sales.cart.empty`, `bookings.panel.noLocations` |
| `{package}.admin.{noun}` | Admin UI | `admin.teams.members`, `assets.uploader.altText` |
| `errors.{context}` | Error messages | `errors.failedToCopy`, `errors.generic` |
| `messages.{event}` | Success/info messages | `messages.copiedToClipboard`, `messages.saved` |
| `navigation.{item}` | Nav labels | `navigation.team`, `navigation.translations` |

---

## Rules for All Translation Work

- **Always use `useT()`** — not `useI18n().t()`
- **nl/fr placeholders**: copy English text when translation isn't available yet
- **Add `_todo: true`** at the parent object level to flag untranslated keys
- **Never remove a key** from nl/fr without removing it from en.json too
- **Run `npx nuxt typecheck`** after modifying any .vue or .ts files
- **Key paths must be consistent** — if `common.save` exists in en.json, use that exact path everywhere

---

## Previous Audit Reference

Last full audit: `docs/reports/translation-audit-report-20260220.md`

Known state after that audit:
- Perfectly synced locale files: crouton-i18n, crouton-admin, crouton-assets, crouton-bookings, crouton-pages, crouton-sales, crouton-triage
- No locale infrastructure: crouton-core, crouton-editor, crouton-flow, crouton-collab
- Fully complete: crouton-auth, crouton-triage
- Critical (zero t() usage): crouton-sales
