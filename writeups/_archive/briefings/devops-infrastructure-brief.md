> 🗄️ **Archived 2026-11-04 (#3352) — overtaken:** bundle budget shipped (https://github.com/FriendlyInternet/nuxt-crouton/issues/1581); changelog (https://github.com/FriendlyInternet/nuxt-crouton/issues/1600) and Renovate (https://github.com/FriendlyInternet/nuxt-crouton/issues/141, no-bot policy) dropped. Historical record, not current guidance.

# DevOps Infrastructure Brief

## Summary

A comprehensive plan to mature the DevOps infrastructure for the nuxt-crouton monorepo. Covers 8 initiatives across local development, CI/CD, dependency management, and Pi agent automation. Each initiative includes current state analysis, proposed solution, skill/workflow integration for Pi agent automation, and implementation notes.

**Goal:** Every improvement should be automatable by the Pi agent through skills, hooks, or CI workflows — no manual babysitting.

## Current State

### What we have
- **CI** (`ci.yml`): lint, typecheck (MCP only), test suite, docs check, field-type sync validation, changeset check (warn-only), publint/attw
- **Deploy workflows**: Per-app Cloudflare Pages deploys (velo, alexdeforce, triage, thinkgraph) with layer caching
- **ThinkGraph CI**: Branch-specific CI (`thinkgraph/` prefix) that reports results back to ThinkGraph via webhook
- **ThinkGraph deploy previews**: Webhook listener that captures Cloudflare preview URLs and sends them back to ThinkGraph
- **Skills**: `/commit`, `/deploy`, `/review`, `/audit`, `/sync-docs`, `/i18n-check`
- **Changesets**: Configured but unused — no `.md` files exist, CI check only warns, `/commit` skill never runs `pnpm changeset`
- **Pi worker**: HTTP dispatch, PM tools (update_workitem, get_workitem, create_pr), systemd service on Raspberry Pi 5
- **Playwright**: Root e2e config (test-bookings app) + template config for apps, auth state management

### What we're missing
- No pre-commit hooks (lint/typecheck bypass possible)
- No dependency update automation
- No bundle size tracking
- No security audit in CI
- No branch protection rules
- No worktree caching strategy (Pi installs from scratch each time)
- No visual regression / screenshot capture in the Pi pipeline
- Changesets configured but abandoned — creates confusion

---

## Initiative 1: Pre-Commit Hook

### Problem
Manual `git commit` (outside `/commit` skill) bypasses lint, typecheck, i18n checks. Even within the skill, there's no automated gate before code enters the repo.

### Proposal
Use `simple-git-hooks` + `lint-staged` for a lightweight, zero-config hook.

### Implementation

**Root `package.json` additions:**
```json
{
  "devDependencies": {
    "simple-git-hooks": "^2.11.0",
    "lint-staged": "^15.2.0"
  },
  "simple-git-hooks": {
    "pre-commit": "pnpm lint-staged"
  },
  "lint-staged": {
    "*.{ts,vue,js,mjs}": "eslint --fix"
  }
}
```

**Setup command** (run once after install):
```bash
pnpm add -Dw simple-git-hooks lint-staged
npx simple-git-hooks
```

### Decision: Include typecheck?
- **Option A**: Lint only (~2-5s) — fast, catches formatting/import issues
- **Option B**: Lint + typecheck (~30-60s) — thorough, but slow for quick commits
- **Recommendation**: Option A. Typecheck runs in CI and is enforced by `/commit` skill. The hook catches the most common mistakes fast. `--no-verify` escape hatch available for WIP commits.

### Skill integration
No skill changes needed — `simple-git-hooks` runs automatically. The `/commit` skill already runs typecheck separately.

### Pi agent impact
The Pi agent uses `git commit` via the `create_pr` PM tool. The pre-commit hook will run automatically for the Pi too, catching issues before they reach GitHub. If the Pi needs to bypass (e.g., WIP branch), it can use `--no-verify` — but this should be the exception.

---

## Initiative 2: Worktree Caching + Screenshot Pipeline

### Problem
When the Pi creates worktrees for tasks, each worktree needs a full `pnpm install` + `nuxt prepare`. On a Raspberry Pi 5 this takes minutes. There's also no way to capture visual proof of changes — the Pi completes work but ThinkGraph has no screenshots for acceptance review.

### Proposal: Part A — pnpm Global Virtual Store

pnpm's content-addressable store can be shared across all worktrees. Instead of downloading/linking packages per worktree, they hard-link from a single shared store.

**Setup** (one-time on Pi):
```bash
# Enable global virtual store
pnpm config set store-dir ~/.pnpm-store
```

**Result:**
- 1st worktree: ~45s install (populates store)
- Subsequent worktrees: ~2-5s install (symlinks only)
- Disk: ~500MB shared + ~5MB per worktree (instead of ~500MB each)

**`.npmrc` at repo root** (so CI and all machines use it):
```ini
store-dir=~/.pnpm-store
```

### Proposal: Part B — Worktree Setup Skill

New skill `/worktree-setup` that the Pi runs as step 1 of any task:

```
1. git worktree add /tmp/thinkgraph/{work-item-id} -b thinkgraph/{work-item-id}
2. cd /tmp/thinkgraph/{work-item-id}
3. pnpm install --frozen-lockfile    # Fast with shared store
4. pnpm --filter {app} exec nuxt prepare
5. Report ready status back to ThinkGraph
```

This skill would be called by the Pi worker's session-manager before handing off to the agent.

### Proposal: Part C — Screenshot Pipeline

After the Pi completes work in a worktree, capture screenshots for visual acceptance in ThinkGraph.

**Architecture:**
```
Pi completes code changes
  ↓
Build app in worktree: pnpm --filter {app} build && pnpm --filter {app} preview
  ↓
Playwright captures screenshots of key pages
  ↓
Upload screenshots to blob storage (crouton-assets API)
  ↓
Update work item with screenshot URLs via update_workitem tool
  ↓
ThinkGraph displays screenshots in acceptance panel
```

**New PM tool — `capture_screenshots`:**
```typescript
{
  name: 'capture_screenshots',
  description: 'Build, preview, and capture screenshots of the app',
  parameters: {
    app: string,        // e.g., 'velo', 'triage'
    pages: string[],    // e.g., ['/', '/teams', '/settings']
    worktreePath: string
  }
}
```

**Implementation:**
```typescript
// In thinkgraph-worker — new tool
async function captureScreenshots(app: string, pages: string[], worktreePath: string) {
  // 1. Build and preview
  await exec(`cd ${worktreePath} && pnpm --filter ${app} build`)
  const preview = spawn('pnpm', ['--filter', app, 'preview'], { cwd: worktreePath })
  await waitForPort(3000)

  // 2. Capture with Playwright
  const browser = await chromium.launch()
  const page = await browser.newPage()
  const screenshots: string[] = []

  for (const route of pages) {
    await page.goto(`http://localhost:3000${route}`)
    await page.waitForLoadState('networkidle')
    const buffer = await page.screenshot({ fullPage: true })

    // 3. Upload to blob storage
    const url = await uploadToBlob(buffer, `screenshots/${app}/${route}.png`)
    screenshots.push(url)
  }

  await browser.close()
  preview.kill()

  return screenshots
}
```

**ThinkGraph UI extension:**
- Work item card shows screenshot thumbnails
- Click to expand/compare
- Acceptance panel: approve/reject with visual context
- Optional: side-by-side diff with baseline screenshots from main branch

### Playwright on Raspberry Pi 5
- Chromium runs on ARM64 (Pi 5 has enough power)
- `npx playwright install chromium` — installs ARM64 binary
- Headless mode only (no display needed)
- Memory: ~200MB per browser instance — manageable with Pi 5's 8GB RAM

### Pi agent impact
This is the biggest win for the Pi pipeline. Currently: Pi does work → text output → human reviews code. With this: Pi does work → screenshots → human reviews visually in ThinkGraph → approve/reject. Dramatically reduces the review burden.

---

## Initiative 3: Renovate

### Problem
Dependencies go stale. Manual updates are tedious across 20+ packages. Security patches get missed.

### Proposal
Install Renovate GitHub App with monorepo-optimized config.

**`renovate.json` at repo root:**
```json
{
  "$schema": "https://docs.renovatebot.com/renovate-schema.json",
  "extends": [
    "config:recommended",
    "schedule:monthly"
  ],
  "enabledManagers": ["npm"],
  "postUpdateOptions": ["pnpmDedupe"],
  "dependencyDashboard": true,
  "lockFileMaintenance": {
    "enabled": true,
    "schedule": ["before 5am on the first day of the month"]
  },
  "packageRules": [
    {
      "description": "Automerge patch updates for non-critical deps",
      "matchUpdateTypes": ["patch", "pin", "digest"],
      "automerge": true,
      "automergeType": "pr",
      "platformAutomerge": true
    },
    {
      "description": "Group Nuxt ecosystem",
      "matchPackagePatterns": ["^@nuxt/", "^nuxt", "^@nuxtjs/"],
      "groupName": "nuxt-ecosystem"
    },
    {
      "description": "Group type definitions",
      "matchPackagePatterns": ["^@types/"],
      "groupName": "type-definitions",
      "automerge": true
    },
    {
      "description": "Group devDependencies",
      "matchDepTypes": ["devDependencies"],
      "groupName": "dev-dependencies",
      "schedule": ["monthly"]
    },
    {
      "description": "Never automerge major versions",
      "matchUpdateTypes": ["major"],
      "automerge": false,
      "labels": ["major-update"]
    },
    {
      "description": "Security updates bypass schedule",
      "matchCategories": ["security"],
      "automerge": true,
      "schedule": ["at any time"]
    }
  ],
  "vulnerabilityAlerts": {
    "labels": ["security"],
    "automerge": true
  },
  "prHourlyLimit": 2,
  "prConcurrentLimit": 5,
  "ignoreDeps": []
}
```

**Key decisions:**
- **Monthly schedule** — reduces noise for solo dev
- **Automerge patches** — safe with CI gate
- **Group by ecosystem** — one PR for all Nuxt updates, one for types, etc.
- **Security bypasses schedule** — urgent patches land immediately
- **pnpmDedupe** — keeps lockfile clean in monorepo

### Setup
1. Install Renovate GitHub App on `FriendlyInternet/nuxt-crouton`
2. Add `renovate.json` to repo root
3. Renovate creates initial "Configure Renovate" PR
4. Merge it — Renovate starts creating PRs

### Skill integration
No skill needed — Renovate runs as a GitHub App. PRs are created automatically, CI validates them, automerge handles the rest. Manual review only for major version bumps.

### Pi agent impact
Renovate PRs could be dispatched to Pi for review/testing if needed (via ThinkGraph). But by default, automerge handles patches and CI validates — no Pi involvement required.

---

## Initiative 4: Bundle Size Tracking (Nuxt Analyze)

### Problem
No visibility into bundle size changes. A PR could add 500KB of JS and nobody would notice until users complain about load times.

### Proposal
Add `nuxi analyze` to CI with PR comments showing size delta.

### Implementation

**New CI job in `ci.yml`:**
```yaml
bundle-analysis:
  name: Bundle Size Check
  if: github.event_name == 'pull_request'
  runs-on: ubuntu-latest
  steps:
    - uses: actions/checkout@v4
      with:
        fetch-depth: 0

    - uses: pnpm/action-setup@v4
    - uses: actions/setup-node@v4
      with:
        node-version: '20'
        cache: 'pnpm'

    - run: pnpm install --frozen-lockfile --ignore-scripts

    - name: Build layer packages
      run: |
        pnpm --filter '@fyit/crouton-core' build
        pnpm --filter '@fyit/crouton-auth' build
        pnpm --filter '@fyit/crouton' build

    - name: Analyze PR bundle
      run: |
        cd apps/velo  # or whichever app matters most
        npx nuxi build --analyze
        mv .nuxt/analyze pr-analyze

    - name: Analyze base bundle
      run: |
        git checkout origin/main
        pnpm install --frozen-lockfile --ignore-scripts
        pnpm --filter '@fyit/crouton-core' build
        pnpm --filter '@fyit/crouton-auth' build
        pnpm --filter '@fyit/crouton' build
        cd apps/velo
        npx nuxi build --analyze
        mv .nuxt/analyze base-analyze

    - name: Compare and comment
      uses: actions/github-script@v7
      with:
        script: |
          // Compare client bundle sizes from nitro stats
          // Post delta as PR comment
```

**New skill — `/analyze`:**
```
Run nuxi analyze on a specific app, show breakdown, flag chunks > 100KB
```

### Considerations
- `nuxi build --analyze` is slow (~2-3 min per app). Only run on PRs, not pushes.
- Start with one app (e.g., velo or triage) — don't analyze all apps per PR.
- Could use `bundlephobia`-style comment format on PRs.
- `nuxt analyze` outputs to `.nuxt/analyze/` as HTML — could upload as artifact.

### Pi agent impact
When the Pi creates a PR, the bundle analysis runs in CI automatically. If the delta is large, the CI comment warns. The Pi's reviewer stage could parse the bundle comment to flag regressions.

---

## Initiative 5: pnpm Audit in CI

### Problem
No automated security scanning of dependencies. Vulnerabilities in transitive dependencies go unnoticed.

### Proposal
Add a security audit job to `ci.yml`.

### Implementation

**New job in `ci.yml`:**
```yaml
security-audit:
  name: Security Audit
  runs-on: ubuntu-latest
  steps:
    - uses: actions/checkout@v4

    - uses: pnpm/action-setup@v4
    - uses: actions/setup-node@v4
      with:
        node-version: '20'
        cache: 'pnpm'

    - run: pnpm install --frozen-lockfile --ignore-scripts

    - name: Audit production dependencies
      run: pnpm audit --prod --audit-level=high
```

**Handling false positives:**

Create `scripts/audit-allowlist.json`:
```json
{
  "ignored": [],
  "reason": "Document why each CVE is ignored",
  "lastReviewed": "2026-03-21"
}
```

### Decision: Block or warn?
- **Option A**: `continue-on-error: true` — warns but doesn't block PRs
- **Option B**: Hard fail on high/critical — blocks merge until resolved
- **Recommendation**: Start with Option A (warn). Switch to Option B once you've established a clean baseline and have an allowlist for known false positives.

### Skill integration
No skill needed — runs in CI. Could add `/audit-deps` skill for on-demand local checks.

---

## Initiative 6: Branch Protection Rules

### Problem
Nothing prevents force-pushing to main, merging without CI, or accidentally deleting the main branch.

### Proposal
Configure via GitHub API — one-time setup.

### Implementation

**Script: `scripts/setup-branch-protection.sh`:**
```bash
#!/bin/bash
REPO="FriendlyInternet/nuxt-crouton"

gh api repos/$REPO/branches/main/protection \
  --method PUT \
  --input - << 'EOF'
{
  "required_status_checks": {
    "strict": true,
    "contexts": [
      "Lint & Type Check",
      "Test Suite",
      "MCP Server Tests",
      "Package Validation"
    ]
  },
  "enforce_admins": false,
  "required_pull_request_reviews": null,
  "restrictions": null,
  "allow_force_pushes": false,
  "allow_deletions": false,
  "required_linear_history": false
}
EOF
```

**What this does:**
- Requires CI jobs to pass before merge
- Prevents force push to main
- Prevents deletion of main branch
- Does NOT require PR reviews (solo dev — you'd be reviewing yourself)
- Does NOT enforce on admins (you can bypass in emergencies)
- Does NOT require linear history (merge commits are fine)

### Pi agent impact
The Pi creates PRs targeting main. Branch protection ensures those PRs must pass CI before merge. This is the safety net for autonomous agent work.

---

## Initiative 7: Deploy Previews for All Apps

### Problem
Only ThinkGraph has deploy preview webhooks. Other apps (velo, triage, alexdeforce) don't get preview URLs on PRs.

### Current state
- Cloudflare Pages auto-generates preview URLs for any branch push
- ThinkGraph has `thinkgraph-deploy-preview.yml` that captures the URL and sends it to ThinkGraph
- Other apps rely on manual `wrangler pages deploy` or the deploy workflows

### Proposal
Extend the preview webhook pattern to all apps, and add PR comments with preview URLs.

### Implementation

**New workflow: `.github/workflows/deploy-preview-comment.yml`:**
```yaml
name: Deploy Preview Comment

on:
  deployment_status:

jobs:
  comment:
    if: >
      github.event.deployment_status.state == 'success' &&
      github.event.deployment_status.environment != 'Production'
    runs-on: ubuntu-latest
    steps:
      - name: Find PR for branch
        id: find-pr
        run: |
          PR=$(gh pr list --head "${{ github.event.deployment.ref }}" --json number --jq '.[0].number')
          echo "pr=$PR" >> "$GITHUB_OUTPUT"
        env:
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}

      - name: Comment preview URL
        if: steps.find-pr.outputs.pr
        run: |
          gh pr comment ${{ steps.find-pr.outputs.pr }} \
            --body "Preview deployed: ${{ github.event.deployment_status.target_url }}"
        env:
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

### Connecting to screenshot pipeline
Once deploy previews exist for all apps, the screenshot pipeline (Initiative 2C) can capture from the live preview URL instead of building locally on the Pi. This is simpler and more reliable:

```
PR created → Cloudflare builds preview → Preview URL posted to PR
  ↓
ThinkGraph dispatch: "capture screenshots of {preview-url}"
  ↓
Pi runs Playwright against the live preview URL
  ↓
Screenshots uploaded and attached to work item
```

This avoids the Pi needing to build the app locally — it just screenshots the already-deployed preview.

---

## Initiative 8: Changesets Decision

### Problem
Changesets are configured but not used:
- `.changeset/config.json` exists with `"fixed": [["@fyit/crouton-*"]]`
- CI checks for changesets on PRs (warn only)
- `/commit` skill never runs `pnpm changeset`
- No changeset `.md` files have ever been created
- `package.json` has `"release": "changeset version && pnpm publish:packages"`

This creates confusion — are we using changesets or not?

### Options

**Option A: Remove changesets entirely**
- Delete `.changeset/` directory
- Remove `changeset`, `version`, `release` scripts from package.json
- Remove `changeset-check` job from CI
- Remove `@changesets/cli` from devDependencies
- Use `publish-packages.sh` directly with manual version bumps
- Simpler, honest — matches actual workflow

**Option B: Integrate changesets into `/commit` skill**
- Add a step: "If files in `packages/` changed, run `pnpm changeset` and include the generated `.md` file"
- Make the CI check a hard block instead of a warning
- Use `changeset version` + `changeset publish` for releases
- More structured versioning, but adds friction to every package commit

**Option C: Lightweight alternative — manual version bumps**
- Remove changesets
- Add a `/release` skill that bumps versions, generates changelog, publishes
- Version bumps happen at release time, not commit time
- `publish-packages.sh` already handles the publish order

### Recommendation
**Option A** (remove) or **Option C** (replace with `/release` skill). Changesets add overhead for a solo dev with a working publish script. The unused infrastructure creates confusion.

---

## Initiative 9: Original Brief in Commit Messages

### Problem
When reviewing git history, there's no link between a commit and the task/brief that triggered it. The Pi agent receives a prompt and context from ThinkGraph, does the work, but the `/commit` skill only looks at the diff — the *why* behind the work is lost. For human-initiated work, the same applies: the conversation context that led to changes disappears after the session.

### Proposal
Include the originating brief/task description in the commit body using git trailers. Use a file-based handoff so it survives context window compression.

### Architecture

**File-based handoff (Option A — recommended):**

When work begins (either from ThinkGraph dispatch or human conversation), write a context file:

```
.thinkgraph-context
```

**Format:**
```
Brief: Users get silently logged out after 30 minutes. Add a warning toast 5 minutes before session expires so they can extend it.
Work-Item-Id: abc123
Stage: builder
Source: thinkgraph
```

This file is:
- Written by the Pi worker's session-manager at dispatch time (for ThinkGraph tasks)
- Written by the agent at session start (for human-initiated tasks, from the initial ask)
- Read by the `/commit` skill and included in the commit body
- Listed in `.gitignore` — never committed itself

### Commit format with brief

```
feat(crouton-auth): add session expiry warning toast

Warn users 5 minutes before session expires with
an extendable toast notification.

Brief: Users get silently logged out after 30 minutes.
Add a warning toast 5 minutes before session expires
so they can extend it.
Work-Item-Id: abc123
```

Git trailers (`Brief:`, `Work-Item-Id:`) are machine-parseable — tools like `git log --format='%(trailers:key=Work-Item-Id)'` can extract them. ThinkGraph could use this to link commits back to work items.

### Changes needed

**1. Pi worker — `session-manager.ts`:**
Write `.thinkgraph-context` to the worktree before starting the agent session:
```typescript
// Before session.prompt()
const contextFile = path.join(worktreePath, '.thinkgraph-context')
await fs.writeFile(contextFile, [
  `Brief: ${payload.prompt}`,
  `Work-Item-Id: ${payload.nodeId}`,
  `Stage: ${payload.stage || 'unknown'}`,
  `Source: thinkgraph`,
].join('\n'))
```

**2. `/commit` skill — new Step 0.75:**
After sync-docs and i18n-check, before analyzing the working tree:
```
### Step 0.75: Read task context (if available)

Check for `.thinkgraph-context` in the repo root. If present, read it
and include its contents as git trailers in every commit body.

If not present (human session without context file), skip — the commit
skill works exactly as before.
```

**3. `.gitignore`:**
```
.thinkgraph-context
```

### For human-initiated work
The agent could write `.thinkgraph-context` from the user's initial message. This is optional — not every conversation has a clear "brief." But when the user gives a clear task description, capturing it adds value.

A Claude Code hook (`user-prompt-submit`) could auto-create this file from the first message in a session, but that's a refinement for later.

### Pi agent impact
The Pi already has the brief in `payload.prompt`. Writing it to a file is trivial. The real value: when reviewing a ThinkGraph-created PR, every commit traces back to the original ask. `git log --format='%(trailers:key=Work-Item-Id)'` gives you a complete audit trail.

---

## Initiative 10: Error Monitoring (`crouton-monitoring`)

### Problem
Zero observability across all production apps. Errors vanish after page navigation. The in-memory metrics in crouton-triage are lost on every deployment. No alerting, no crash reports, no visibility into what users experience.

### Current state
- `error.vue` in crouton-core — nice UI, but errors are fire-and-forget
- `server/utils/metrics.ts` in crouton-triage — in-memory only, lost on restart
- No error tracking service configured anywhere
- No client-side error capture
- No server-side error logging beyond console

### Landscape analysis

| Solution | Maturity | Nuxt 4 | Cloudflare Pages | Client | Server | Bundle |
|----------|----------|--------|------------------|--------|--------|--------|
| `@sentry/nuxt` v10 | High (official) | Yes | Yes, with config | Yes | Yes | ~30KB |
| `nuxt-bugsnag` v8 | Medium | Yes | Unknown | Yes | No (mock) | Medium |
| `nuxt-logrocket` | Low | Unknown | Unknown | Yes | No | Light |
| Cloudflare Analytics Engine | Native | N/A | Yes | No | Yes | Zero |
| Self-hosted (D1 + KV) | DIY | Yes | Yes | Yes | Yes | Zero |

**Key finding:** `@sentry/nuxt` is the only option that captures both client and server errors. Everything else is client-only or DIY.

### Recommendation: `@sentry/nuxt` as a `crouton-monitoring` package

Create a new package that wraps Sentry with crouton-specific defaults. This keeps the Sentry dependency optional — apps opt in by extending the package.

### Proposal

**New package: `packages/crouton-monitoring/`**

```
packages/crouton-monitoring/
├── nuxt.config.ts          # Module config, Sentry init
├── app/
│   └── plugins/
│       └── sentry.client.ts  # Client-side Sentry init
├── server/
│   └── plugins/
│       └── sentry-cloudflare.ts  # Cloudflare-specific server init
├── package.json
└── CLAUDE.md
```

**Why a package, not just config in each app:**
- Cloudflare requires specific Sentry setup (`sentryCloudflareNitroPlugin` instead of standard server config)
- Every app needs the same `nodejs_compat` compatibility flag
- Centralizes DSN management, environment detection, release tracking
- Apps opt in with one line: `extends: ['@fyit/crouton-monitoring']`
- Easy to swap Sentry for something else later — one package change, not N app changes

### Cloudflare-specific setup

Sentry on Cloudflare Workers requires:

1. **`nodejs_compat` flag** in wrangler config (needed for `AsyncLocalStorage`)
2. **Nitro plugin** instead of `sentry.server.config.ts`:
```typescript
// server/plugins/sentry-cloudflare.ts
import { sentryCloudflareNitroPlugin } from '@sentry/nuxt/module'

export default defineNitroPlugin(sentryCloudflareNitroPlugin({
  dsn: process.env.SENTRY_DSN,
  tracesSampleRate: 0.1,  // 10% of requests
  environment: process.env.CLOUDFLARE_ENV || 'production',
}))
```

3. **Client plugin** (standard):
```typescript
// app/plugins/sentry.client.ts
import * as Sentry from '@sentry/nuxt'

export default defineNuxtPlugin(() => {
  Sentry.init({
    dsn: useRuntimeConfig().public.sentryDsn,
    tracesSampleRate: 0.1,
    replaysSessionSampleRate: 0.05,
    replaysOnErrorSampleRate: 1.0,
  })
})
```

### Known Cloudflare limitations
- Server-side span durations show `0ms` for CPU-bound work (`performance.now()` only advances after I/O in Workers runtime)
- Server monitoring doesn't work in dev mode — must build and deploy to test
- Requires `nodejs_compat` compatibility flag

### What this gives us
- **Client errors**: Unhandled exceptions, Vue component errors, network failures
- **Server errors**: API route failures, SSR crashes, middleware errors
- **Session replay**: See exactly what the user did before a crash (sampled)
- **Source maps**: Real file names in stack traces (auto-uploaded during build)
- **Alerts**: Slack/email when error rates spike
- **Release tracking**: Tie errors to specific deployments
- **Pi worker**: The thinkgraph-worker could also report to Sentry (Node.js SDK, separate from Nuxt)

### Integration with existing metrics
The in-memory metrics in crouton-triage (`server/utils/metrics.ts`) could feed into Sentry's custom metrics API, giving them persistence without building custom storage:

```typescript
// In metrics.ts — after recording a data point
Sentry.metrics.distribution('triage.process.duration', duration, {
  tags: { operation, success: String(success) },
  unit: 'millisecond',
})
```

### Free tier viability
Sentry's free tier (Developer plan):
- 5,000 errors/month
- 50 session replays/month
- 100K spans/month
- Sufficient for your current traffic across all apps

### Stub pattern
For apps that don't want monitoring, `crouton-core` could register a stub (like other optional packages). But since monitoring is purely additive (no UI components), a simple "don't extend the package" is enough — no stub needed.

### Implementation steps
1. Create `packages/crouton-monitoring/` with Nuxt module
2. Set up Sentry project (one per app, or one with environment tags)
3. Add `SENTRY_DSN` to each app's Cloudflare Pages secrets
4. Add `nodejs_compat` to wrangler configs
5. Extend from apps: `extends: ['@fyit/crouton-monitoring']`
6. Source map upload in deploy workflows (Sentry CLI or Vite plugin)

---

## Skill & Workflow Summary

### New skills needed

| Skill | Purpose | Used by |
|-------|---------|---------|
| `/worktree-setup` | Fast worktree init with cached pnpm store | Pi worker |
| `/analyze` | Run nuxt analyze on an app, report bundle breakdown | Human / Pi reviewer |
| `/release` | Bump versions, changelog, publish (replaces changesets) | Human |

### Commit skill update

The `/commit` skill needs a new step (Step 0.75) to read `.thinkgraph-context` and include the original brief as git trailers in commit messages.

### New PM tools needed (thinkgraph-worker)

| Tool | Purpose |
|------|---------|
| `capture_screenshots` | Build/preview app, capture Playwright screenshots, upload to blob |
| `setup_worktree` | Create worktree with fast pnpm install |

### New packages needed

| Package | Purpose |
|---------|---------|
| `crouton-monitoring` | Sentry wrapper with Cloudflare-specific config, opt-in per app |

### CI workflow changes

| File | Change |
|------|--------|
| `ci.yml` | Add `security-audit` job |
| `ci.yml` | Add `bundle-analysis` job (PR only) |
| `ci.yml` | Remove or keep `changeset-check` (depending on Initiative 8 decision) |
| New: `deploy-preview-comment.yml` | Comment preview URLs on PRs for all apps |

### One-time setup tasks

| Task | How |
|------|-----|
| Install `simple-git-hooks` + `lint-staged` | `pnpm add -Dw`, update package.json |
| Install Renovate GitHub App | GitHub marketplace |
| Configure branch protection | Run `scripts/setup-branch-protection.sh` |
| Configure pnpm global store on Pi | `pnpm config set store-dir ~/.pnpm-store` |
| Install Playwright on Pi | `npx playwright install chromium` |
| Add `.thinkgraph-context` to `.gitignore` | One line |
| Create Sentry project | sentry.io, one project per app or shared |
| Add `SENTRY_DSN` to Cloudflare Pages secrets | Per app |
| Add `nodejs_compat` to wrangler configs | Per app |

---

## Implementation Priority

### Phase 1 — Quick wins (same session)
1. **Pre-commit hook** — 10 min, immediate value
2. **Branch protection** — 5 min, one script
3. **pnpm audit in CI** — 5 min, one job addition

### Phase 2 — Pi pipeline (next session)
4. **Worktree caching** — pnpm store config + worktree-setup skill
5. **Screenshot pipeline** — new PM tool + Playwright on Pi + ThinkGraph UI

### Phase 3 — Automation (following session)
6. **Renovate** — install app + config file
7. **Deploy previews** — new workflow
8. **Bundle analysis** — CI job + /analyze skill

### Phase 4 — Traceability & observability
9. **Commit context** — `.thinkgraph-context` file + `/commit` skill update
10. **crouton-monitoring** — Sentry package, Cloudflare config, deploy integration

### Phase 5 — Cleanup
11. **Changesets decision** — remove or integrate
12. **Skill documentation** — update CLAUDE.md with new capabilities

---

## Dependencies Between Initiatives

```
Pre-commit hook ──────────────────── standalone
Branch protection ────────────────── standalone
pnpm audit ───────────────────────── standalone
Worktree caching ─┬───────────────── standalone
                  └─→ Screenshot pipeline (needs fast worktree setup)
                       └─→ Deploy previews (screenshots can use preview URLs instead)
Renovate ─────────────────────────── needs branch protection (automerge requires CI gate)
Bundle analysis ──────────────────── standalone
Commit context ───────────────────── standalone (updates /commit skill)
                                     └─→ Pi worker writes .thinkgraph-context at dispatch time
crouton-monitoring ──────────────── standalone
                                     └─→ Deploy workflows need source map upload step
Changesets decision ──────────────── standalone (but affects /commit skill)
```

## Open Questions

1. **Typecheck in pre-commit?** Lint-only (fast) vs lint+typecheck (thorough) — recommendation: lint-only
2. **Which app for bundle analysis?** Velo? Triage? All? — recommendation: start with one, expand later
3. **Changesets: remove or integrate?** — recommendation: remove, replace with `/release` skill
4. **Screenshot pages per app?** Need a config that maps apps to their key routes for visual capture
5. **Pi Playwright memory?** Running Chromium + Node + Nuxt preview on Pi 5 — need to verify 8GB is enough
6. **Renovate vs Dependabot?** Renovate is better for monorepos (grouping, automerge) — recommendation: Renovate
7. **Sentry project topology?** One project per app (cleaner separation) or one shared project with environment tags (simpler management)?
8. **Sentry free tier sufficient?** 5K errors/month across all apps — likely fine now, may need Team plan ($29/mo) if traffic grows
9. **Commit context for human sessions?** Auto-capture first message as brief, or only for ThinkGraph dispatches?
