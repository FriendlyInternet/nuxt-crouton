#!/usr/bin/env node
/**
 * deploy-detect — decide which apps deploy-apps.yml should deploy, and to which env.
 *
 * Extracted from the inline `detect` bash in .github/workflows/deploy-apps.yml so the
 * decision is a pure, unit-tested function (mirrors scripts/packages-guard.mjs). It fixes
 * #1499: the old bash computed the changed-file set with `git diff … 2>/dev/null || true`,
 * which laundered a *failed* diff into an empty one — indistinguishable from a legitimate
 * "nothing changed" — so a merge that should have deployed was silently skipped while the
 * run reported success ("green but it didn't happen").
 *
 * Two guarantees here:
 *   1. `resolveChangedFiles` NEVER swallows a diff failure. On push-to-main it prefers the
 *      merge's first-parent diff (`HEAD~1..HEAD` — the net change, robust to concurrent
 *      pushes, unlike before..after), and if it cannot resolve ANY base it throws.
 *   2. An EMPTY changed-file set on a triggered push/PR is treated as a compute failure,
 *      not "deploy nothing": the workflow's own `paths:` filter guarantees ≥1 watched file
 *      changed, so empty ⇒ the diff broke ⇒ fail loud (red run → report-failed-deploy
 *      fires) instead of a silent green skip. (An empty *matrix* is still fine — e.g. a
 *      workflow-only change matches no app — that's a non-empty file set with no app hit.)
 *
 *   CLI (used by the workflow):
 *     EVENT=push BASE_SHA=… HEAD_SHA=… node scripts/deploy-detect.mjs
 *       → appends `matrix=…` and `any=…` to $GITHUB_OUTPUT; exit 1 (loud) on a broken diff.
 */
import { execFileSync } from 'node:child_process'
import { readdirSync, existsSync, readFileSync, appendFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

export const ZERO_SHA = '0000000000000000000000000000000000000000'

// #2140: the ONE carve-out from #1297's "PRs only deploy their own app" rule. A PR the pi
// worker opened as a UI-sign-off hold (work-issue-pidev.yml, #1748) is never a fan-out — it's
// exactly one known app, held specifically so a human can look at it — so it opts back into
// the app's full watchPaths instead of the PR-restricted `apps/<app>/**`. Kept as a literal
// HTML-comment marker (not a label) so no extra GitHub API call is needed: the PR body is
// already on the `pull_request` event payload. Must match the marker work-issue-pidev.yml
// appends to HOLD_NOTE — grep both on change.
export const UI_SIGNOFF_MARKER = '<!-- deploy-preview: full-watch -->'

export class DetectError extends Error {}

// Translate a watchPath pattern into a RegExp with the SAME semantics as bash `[[ $f == $pat ]]`
// (used by the old detect job): `*` matches any run of characters INCLUDING `/` and empty, so
// `packages/crouton/**` matches `packages/crouton/<anything>` but not `packages/crouton-core/x`,
// and `pnpm-lock.yaml` is an exact match. Escape every regex metachar EXCEPT `*`, then `*`→`.*`.
export function watchPathToRegExp(pattern) {
  const escaped = String(pattern).replace(/[.+^${}()|[\]\\?]/g, '\\$&').replace(/\*/g, '.*')
  return new RegExp(`^${escaped}$`)
}

export function fileMatchesAny(file, patterns = []) {
  return patterns.some(p => p && watchPathToRegExp(p).test(file))
}

/**
 * Compute the deploy matrix. PURE — no git, no fs. `apps` is the list of opted-in apps
 * (each: { app, stagingUrl, productionUrl, layerPackages, requireWorkerSecrets, watchPaths }).
 *
 * - workflow_dispatch: the single named app, at the requested env (only the explicit
 *   "production" choice reaches production; anything else → staging — the #318 whitelist).
 * - push / pull_request: STAGING only (#318). A pull_request deploys ONLY the app whose OWN
 *   paths (`apps/<app>/**`) changed (#1297 — a shared-package break is caught by the fixture
 *   smoke + the rung-2 push deploy, not a per-PR fan-out) — UNLESS the PR carries the
 *   UI_SIGNOFF_MARKER (#2140), in which case it matches the full watchPaths like a push does,
 *   so the app it needs sign-off on actually gets a live preview. A push always keeps the full
 *   watchPaths.
 */
function toEntry(a, environment) {
  return {
    app: a.app,
    environment,
    stagingUrl: a.stagingUrl || '',
    productionUrl: a.productionUrl || '',
    layerPackages: a.layerPackages || '',
    requireWorkerSecrets: a.requireWorkerSecrets ?? false
  }
}

// workflow_dispatch → the single named app at the requested env (production only for the
// explicit choice — the #318 whitelist).
function dispatchInclude(dispatchApp, dispatchEnv, apps) {
  const a = apps.find(x => x.app === dispatchApp)
  if (!a) return []
  return [toEntry(a, dispatchEnv === 'production' ? 'production' : 'staging')]
}

// push / pull_request → STAGING only. A pull_request matches only the app's OWN paths (#1297),
// unless it's a UI-sign-off hold (fullWatchPr, #2140) — then, like a push, it matches the full
// watchPaths (incl. shared packages).
function changeInclude(event, changedFiles, apps, fullWatchPr) {
  const include = []
  for (const a of apps) {
    const patterns = (event === 'pull_request' && !fullWatchPr) ? [`apps/${a.app}/**`] : (a.watchPaths || [])
    if (changedFiles.some(f => f && fileMatchesAny(f, patterns))) include.push(toEntry(a, 'staging'))
  }
  return include
}

export function computeMatrix({ event, changedFiles = [], dispatchApp = '', dispatchEnv = '', apps = [], fullWatchPr = false }) {
  const include = event === 'workflow_dispatch'
    ? dispatchInclude(dispatchApp, dispatchEnv, apps)
    : changeInclude(event, changedFiles, apps, fullWatchPr)
  return { include, any: include.length > 0 }
}

/**
 * Resolve the changed-file list for a push/PR — the #1499 fix. `git` is injected so it's
 * testable: { isResolvable(ref)->bool, diff(a,b)->string[] }. Throws DetectError rather than
 * ever returning a silent empty list on failure.
 */
export function resolveChangedFiles({ event, baseSha, headSha, git }) {
  if (event === 'pull_request') {
    // A PR's base.sha is always a real, fetched commit — if it won't resolve, something is
    // genuinely wrong; don't paper over it.
    if (!git.isResolvable(baseSha)) throw new DetectError(`PR base sha not resolvable: ${baseSha || '(empty)'}`)
    // THREE-dot (#2087). `git diff A B` is the symmetric difference of two TREES, so a branch
    // that has fallen behind `main` reports everything that landed on main meanwhile as its
    // own change — in reverse. #2080 changed two files under packages/crouton-cli and the
    // two-dot diff reported 21, including apps/{kassa,triage,velo}/nuxt.config.ts (which
    // #2074 had just added to main). That scheduled all three app deploys for a PR that
    // touches no app, and they went red — the visible cost is spurious failures on unrelated
    // PRs. `A...B` diffs from the MERGE BASE, which is what "what did this PR change" means.
    //
    // It can only ever over-deploy, never under — so nothing was silently skipped, and the
    // fix cannot introduce a missed deploy either.
    if (!git.hasMergeBase(baseSha, headSha)) {
      // No merge base (a shallow checkout that doesn't reach it). Fail loud rather than
      // silently falling back to two-dot — that fallback IS this bug, and #1499's rule is
      // that an unresolvable diff must never quietly become a wrong answer.
      throw new DetectError(
        `PR merge-base not resolvable for ${baseSha}...${headSha} — the checkout is probably too `
        + `shallow. Refusing to fall back to a two-dot diff, which reports every commit that `
        + `landed on the base branch since this one forked as if this PR made it (#2087).`,
      )
    }
    return { files: git.diffFrom(baseSha, headSha), source: 'pr:base...head' }
  }
  // push-to-main: prefer the tip's first-parent diff — for a merge commit that IS the net PR
  // change, and it doesn't depend on github.event.before (which is wrong under concurrent
  // pushes — the #1477 cause). Fall back to before..after only if HEAD~1 is unavailable
  // (e.g. an unexpectedly shallow checkout); if neither resolves, fail loud.
  if (git.isResolvable('HEAD~1')) return { files: git.diff('HEAD~1', 'HEAD'), source: 'push:first-parent' }
  if (baseSha && baseSha !== ZERO_SHA && git.isResolvable(baseSha)) {
    return { files: git.diff(baseSha, headSha), source: 'push:before..after' }
  }
  throw new DetectError('cannot resolve a diff base on push (no HEAD~1, no usable before-sha)')
}

// ── CLI ───────────────────────────────────────────────────────────────────────
function realGit() {
  const run = args => execFileSync('git', args, { encoding: 'utf8' })
  return {
    isResolvable(ref) {
      try {
        run(['rev-parse', '--verify', '--quiet', `${ref}^{commit}`])
        return true
      } catch {
        return false
      }
    },
    diff(a, b) {
      return run(['diff', '--name-only', a, b]).split('\n').map(s => s.trim()).filter(Boolean)
    },
    // THREE-dot: from the merge base of a and b (#2087). A separate method, not a flag on
    // `diff`, so the injected fake can answer the two differently — the old fake returned one
    // canned list for `diff(a, b)` and therefore could not express the distinction at all,
    // which is why every existing test passed against the wrong diff form.
    diffFrom(a, b) {
      return run(['diff', '--name-only', `${a}...${b}`]).split('\n').map(s => s.trim()).filter(Boolean)
    },
    // `git merge-base` is the only honest way to ask this. NOT `isResolvable('a...b')` —
    // that runs `rev-parse --verify 'a...b^{commit}'`, which a RANGE can never satisfy, so
    // the guard threw on every PR. The unit fake happily declared the range resolvable, so
    // the tests agreed with the code and both were wrong; only running it against the real
    // repo showed it. Twice in one change, the same lesson.
    hasMergeBase(a, b) {
      try {
        run(['merge-base', a, b])
        return true
      } catch {
        return false
      }
    }
  }
}

function loadApps(root = 'apps') {
  if (!existsSync(root)) return []
  const out = []
  for (const name of readdirSync(root)) {
    const cfgPath = `${root}/${name}/deploy.config.json`
    if (!existsSync(cfgPath)) continue // not opted in
    let cfg = {}
    try {
      cfg = JSON.parse(readFileSync(cfgPath, 'utf8'))
    } catch {
      continue
    }
    out.push({
      app: name,
      stagingUrl: cfg.stagingUrl || '',
      productionUrl: cfg.productionUrl || '',
      layerPackages: cfg.layerPackages || '',
      requireWorkerSecrets: cfg.secrets?.required ?? false,
      watchPaths: Array.isArray(cfg.watchPaths) ? cfg.watchPaths : []
    })
  }
  return out
}

function main() {
  const event = process.env.EVENT || ''
  const apps = loadApps()

  let changedFiles = []
  if (event !== 'workflow_dispatch') {
    const { files, source } = resolveChangedFiles({
      event,
      baseSha: process.env.BASE_SHA || '',
      headSha: process.env.HEAD_SHA || '',
      git: realGit()
    })
    changedFiles = files
    console.log(`Changed files (${source}):`)
    for (const f of changedFiles) console.log(`  ${f}`)
    // The trigger's own paths: filter guarantees a watched file changed, so an empty set can
    // only mean the diff failed to compute — fail loud instead of a silent green no-deploy.
    if (changedFiles.length === 0) {
      throw new DetectError(
        `${event} triggered deploy-apps but the changed-file set is EMPTY — the diff failed to `
        + `compute (see #1499). Refusing to report success with no deploy.`
      )
    }
  }

  // #2140: a UI-sign-off-held PR (work-issue-pidev.yml) carries this marker in its body so it
  // opts into the full watchPaths instead of the PR-restricted apps/<app>/** — see
  // UI_SIGNOFF_MARKER above. github.event.pull_request.body is already on the event payload,
  // so this needs no extra API call.
  const fullWatchPr = event === 'pull_request' && (process.env.PR_BODY || '').includes(UI_SIGNOFF_MARKER)
  if (fullWatchPr) console.log('UI sign-off hold marker found on the PR body — matching full watchPaths (#2140)')

  const { include, any } = computeMatrix({
    event,
    changedFiles,
    dispatchApp: process.env.DISPATCH_APP || '',
    dispatchEnv: process.env.DISPATCH_ENV || '',
    apps,
    fullWatchPr
  })
  const matrix = JSON.stringify({ include })
  const out = process.env.GITHUB_OUTPUT
  if (out) appendFileSync(out, `matrix=${matrix}\nany=${any}\n`)
  console.log(`Detected matrix: ${matrix}`)
  console.log(`any=${any}`)
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  try {
    main()
  } catch (err) {
    // ::error:: surfaces in the run summary; a non-zero exit makes the run RED so the
    // post-merge watchdog (report-failed-deploy.yml) engages — the whole point of #1499.
    console.error(`::error::deploy-detect: ${err.message}`)
    process.exit(1)
  }
}
