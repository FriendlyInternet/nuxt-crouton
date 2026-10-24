---
name: review
layer: method
description: Code Review Assistant. Reviews uncommitted changes or recent commits for pattern violations, security issues, and bugs. Optimized for solo dev moving fast. Use when reviewing code before or after committing.
argument-hint: "[last N | --scope <package> | --file <path>]"
allowed-tools: Bash, Read, Grep, Glob, Agent
---

# Review Skill

Fast, opinionated code review for a solo dev shipping quickly. Catches real problems, skips bikeshedding.

## Modes

| Invocation | What it reviews |
|------------|----------------|
| `/review` | All uncommitted changes (staged + unstaged) |
| `/review last N` | The last N commits on current branch |
| `/review --scope <pkg>` | Uncommitted changes filtered to a package |
| `/review --file <path>` | A single file |

## Rules

1. **No style opinions** — formatting, naming preferences, comment style → skip. That's linting.
2. **No scope creep** — only review what's in the diff. Never suggest "while you're here..." changes.
3. **No praise** — don't say "nice work" or "good use of". Just flag problems or say "clean".
4. **Severity matters** — categorize every finding. Don't mix critical bugs with nits.
5. **Be specific** — file, line, what's wrong, how to fix. No vague "consider improving".
6. **Trust the dev** — if something looks intentional, don't flag it. Flag things that look accidental.

## Severity Levels

| Level | Meaning | Action |
|-------|---------|--------|
| 🔴 **Critical** | Security hole, data loss risk, crash | Must fix before shipping |
| 🟡 **Warning** | Bug likely, pattern violation, missing validation | Should fix soon |
| 🔵 **Note** | Minor issue, potential improvement | Fix when convenient |

## Fast-Path for Non-Code Changes

When the diff contains **only** documentation and config files (`.md`, `.yml`, `.yaml`, `.json`, `.toml`, `.txt`) and **no** code files (`.ts`, `.vue`, `.css`, `.scss`, `.js`, `.mjs`), skip the full checklist and use this shortened review:

**Check:**
- [ ] Content is accurate and not misleading
- [ ] No typos or grammar issues
- [ ] Links and references are valid (file paths, URLs, anchors)
- [ ] Formatting is consistent with surrounding content
- [ ] No secrets, tokens, or credentials in the content

**Skip:** Security, correctness, project patterns, package boundaries, dead code, API endpoints, Vue components — these don't apply to non-code changes.

**Detection:**
```bash
# If this returns nothing, it's a doc-only diff → use fast-path
git diff --name-only <base>..<branch> | grep -E '\.(ts|vue|css|scss|js|mjs)$'
```

Produce the same structured report format, just with the shorter checklist.

## Workflow

### Step 1: Gather the diff

**For uncommitted changes** (`/review` or `/review --scope`):
```bash
git diff                  # unstaged
git diff --cached         # staged
git status               # new files
```

**For recent commits** (`/review last N`):
```bash
git log --oneline -N
git diff HEAD~N..HEAD
```

**For single file** (`/review --file <path>`):
```bash
git diff -- <path>        # if modified
# or just read the file if it's new
```

If `--scope` is set, filter to files matching `packages/<pkg>/**` or `apps/<pkg>/**`.

### Step 2: Read the full context

For every changed file, read the COMPLETE file (not just the diff). You need surrounding context to catch:
- Unused imports after a refactor
- Broken references from renames
- Duplicated logic that already exists elsewhere

For files over 500 lines, read at minimum the changed sections ±50 lines.

### Step 3: Run checks

Check every changed file against this checklist. Skip categories that don't apply (e.g., skip "API" checks for a component file).

#### Security
- [ ] No hardcoded secrets, API keys, tokens
- [ ] No `v-html` with user-controlled content (XSS)
- [ ] Server endpoints validate input (especially route params and body)
- [ ] Server endpoints check team authorization (`useTeamContext()`)
- [ ] No raw SQL — should use drizzle queries
- [ ] No `eval()`, `new Function()`, or dynamic `import()` with user input

#### Correctness
- [ ] Async operations wrapped in try/catch or use `{ data, error }` pattern
- [ ] Reactive references not destructured (loses reactivity)
- [ ] `await` not missing on async calls
- [ ] Correct HTTP method on API routes (filename matches: `.get.ts`, `.post.ts`, etc.)
- [ ] No infinite loops or unbounded recursion
- [ ] Proper cleanup in `onUnmounted` for listeners/intervals

#### Project Patterns (from CLAUDE.md)
- [ ] `<script setup lang="ts">` — never Options API
- [ ] `hub: { db: 'sqlite' }` — never `hub: { database: true }`
- [ ] `useTeamContext()` — never raw `route.params.id` for team ID
- [ ] `createError({ status, statusText })` — never `statusCode`/`statusMessage`
- [ ] Nuxt UI v4 names — `USeparator`, `USwitch`, `UDropdownMenu` (not v3 names)
- [ ] No `resolveComponent()` for optional cross-package components (use stub pattern)
- [ ] `useState()` for state — no Pinia
- [ ] Composition API only

#### Package Boundaries
- [ ] No direct DB queries for tables owned by another package (e.g., crouton-email querying `teamSettings` directly instead of going through crouton-auth exports)
- [ ] No type imports from deep internal paths of another package — use public exports or auto-imports
- [ ] API endpoints live in the package that owns the domain (e.g., team settings CRUD in crouton-core/crouton-admin, not scattered)
- [ ] No server utils in package A that duplicate logic from package B (e.g., re-implementing team resolution instead of using crouton-auth's `resolveTeamAndCheckMembership`)
- [ ] Components that belong to a domain live in that domain's package (e.g., email components in crouton-email, not crouton-core)
- [ ] Auto-imports from other packages are used via Nitro/Nuxt auto-import, not manual deep imports

#### Dead Code
- [ ] No unused imports
- [ ] No unreachable code after return/throw
- [ ] No commented-out code blocks (delete it, git has history)
- [ ] No unused variables (except intentional `_` prefix)

#### API Endpoints (server/ files only)
- [ ] Input validation with zod or similar
- [ ] Consistent error responses using `createError()`
- [ ] Team-scoped endpoints use `useTeamContext()`
- [ ] Return types are consistent (not mixing shapes)

#### Gates, Checks & Flow Steps

Applies when the diff adds or changes **a rule that judges other code** (a validator, a CI check, a
sign-off gate) or **a step that mutates state** (writes a file, commits, labels, dispatches). See
`AGENTS.md` → *Authoring a gate* for the argument.

- [ ] **Can this path exit 0 having done nothing?** The recurring defect is a silent no-op, not a crash:
      `git add` on a gitignored path adds nothing (#1933) · `--add-label X` on an issue already carrying
      `X` fires no event, so nothing downstream wakes (#1750) · `rows.filter(r => r.refTarget)` dropped
      the relations *missing* a target, then reported "No relationships" (#1953)
- [ ] **What in the output would prove it acted?** A count, a path, a diff — if the run's own output
      can't distinguish "did the work" from "did nothing", say so and add the proof
- [ ] **Where it can no-op, assert the effect** instead of assuming it — check the artifact is
      committable rather than trusting the write; remove-then-add rather than hoping the event fires
- [ ] **Was the rule run over the corpus, with the hit count reported?** Green unit tests only prove
      the rule matches its author's imagination — #1957's first version passed 8 and would have refused
      4 shipping schemas. Cheap to do:
      `node scripts/corpus-check.mjs --glob 'apps/*/schemas/*.json' --rule ./my-rule.mjs`
      (advisory — skip it when there's no meaningful corpus, e.g. a rule over one generated file)
- [ ] **Does "no matches" mean clean, or mean the query was wrong?** A scan that matched nothing has
      proved nothing

#### Vue Components (*.vue files only)
- [ ] Props have TypeScript types
- [ ] Emits are declared with `defineEmits`
- [ ] No direct DOM manipulation (use refs or VueUse)
- [ ] Modal/Slideover uses v4 pattern (`v-model` + `#content="{ close }"`)

### Step 4: Produce the report

#### If nothing found:

```
## Review: clean ✅

Reviewed N files, no issues found.
```

#### If issues found:

```
## Review Summary

| Severity | Count |
|----------|-------|
| 🔴 Critical | X |
| 🟡 Warning | Y |
| 🔵 Note | Z |

### 🔴 Critical

#### [Short title]
**File:** `path/to/file.ts:42`
**Issue:** [What's wrong]
**Fix:** [How to fix — be specific, show code if helpful]

---

### 🟡 Warning

#### [Short title]
**File:** `path/to/file.vue:15`
**Issue:** [What's wrong]
**Fix:** [How to fix]

---

### 🔵 Note

#### [Short title]
**File:** `path/to/file.ts:88`
**Issue:** [What's wrong]
**Fix:** [How to fix]
```

### Step 5: Offer to fix

After presenting the report:

> Want me to fix any of these? (all / critical only / pick by number)

If user says "all" or "critical only", fix them directly — no confirmation per fix. Use Edit tool. After fixing, run `pnpm typecheck` on affected apps.

## Parallelization

When reviewing 5+ files, split into parallel agents:
- Group files by directory (server/, app/components/, app/composables/)
- Each agent reviews its group and returns findings
- Compile findings into single report

For <5 files, review sequentially in the main context — agent overhead isn't worth it.

## Edge Cases

### No changes
```
Nothing to review — working tree is clean and no commits specified.
```

### Binary/generated files
Skip: `*.sqlite`, `*.wasm`, `pnpm-lock.yaml`, `.nuxt/`, `dist/`, `.wrangler/`, `node_modules/`

### Large diffs (50+ files)
Warn the user and suggest scoping:
```
50+ files changed. Consider scoping:
  /review --scope crouton-core
  /review --file path/to/important-file.ts
```
Then proceed if they confirm, using parallel agents.