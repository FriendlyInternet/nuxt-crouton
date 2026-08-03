/**
 * Contract for scripts/deploy-detect.mjs — the #1499 fix. Proves the detect decision:
 *   • never launders a failed diff into a silent empty result (fail loud / fall back),
 *   • prefers the merge's first-parent diff on push-to-main,
 *   • reproduces the watchPath matching of the old bash `[[ $f == $pat ]]` exactly, and
 *   • a crouton-sales-only merge always puts the consuming app (fanfare) in the matrix.
 *
 *   node --test scripts/deploy-detect.test.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  watchPathToRegExp, fileMatchesAny, computeMatrix, resolveChangedFiles, DetectError, ZERO_SHA
} from './deploy-detect.mjs'

// A stand-in for the injected git: declared-resolvable refs + canned diffs.
const fakeGit = ({ resolvable = [], diffs = {} }) => ({
  isResolvable: ref => resolvable.includes(ref),
  diff: (a, b) => diffs[`${a}..${b}`] || []
})

const APPS = [
  { app: 'fanfare', stagingUrl: 'https://kassa.pmcp.dev', productionUrl: 'https://kassa.friendlyinter.net', layerPackages: 'lp-f', requireWorkerSecrets: false, watchPaths: ['apps/fanfare/**', 'packages/crouton-sales/**', 'packages/crouton-core/**', 'pnpm-lock.yaml'] },
  { app: 'triage', stagingUrl: 'https://triage-preview.pmcp.dev', productionUrl: '', layerPackages: 'lp-t', requireWorkerSecrets: false, watchPaths: ['apps/triage/**', 'packages/crouton-triage/**', 'pnpm-lock.yaml'] },
  { app: 'velo', stagingUrl: 'https://velo.pmcp.dev', productionUrl: '', layerPackages: 'lp-v', requireWorkerSecrets: false, watchPaths: ['apps/velo/**', 'packages/crouton-bookings/**', 'pnpm-lock.yaml'] }
]
const names = r => r.include.map(e => e.app)

// ── watchPath matching (must match bash `[[ $f == $pat ]]` semantics) ─────────
test('`dir/**` matches nested files but not a sibling with a shared prefix', () => {
  assert.equal(fileMatchesAny('packages/crouton/x.ts', ['packages/crouton/**']), true)
  assert.equal(fileMatchesAny('packages/crouton/a/b/c.ts', ['packages/crouton/**']), true)
  // the classic over-match trap: crouton-core must NOT match packages/crouton/**
  assert.equal(fileMatchesAny('packages/crouton-core/x.ts', ['packages/crouton/**']), false)
})

test('an exact watchPath (pnpm-lock.yaml) is exact, not a prefix', () => {
  assert.equal(fileMatchesAny('pnpm-lock.yaml', ['pnpm-lock.yaml']), true)
  assert.equal(fileMatchesAny('pnpm-lock.yaml.bak', ['pnpm-lock.yaml']), false)
  assert.equal(fileMatchesAny('a/pnpm-lock.yaml', ['pnpm-lock.yaml']), false)
})

test('watchPathToRegExp is anchored', () => {
  assert.equal(watchPathToRegExp('apps/velo/**').test('xapps/velo/y'), false)
})

// ── computeMatrix: push (merge to main) ───────────────────────────────────────
test('#1477 regression: a crouton-sales-only merge deploys the consuming app (fanfare)', () => {
  const r = computeMatrix({ event: 'push', changedFiles: ['packages/crouton-sales/app/x.vue', 'packages/crouton-sales/schemas/y.json'], apps: APPS })
  assert.deepEqual(names(r), ['fanfare'])
  assert.equal(r.any, true)
  assert.equal(r.include[0].environment, 'staging') // push → staging only (#318)
  assert.equal(r.include[0].stagingUrl, 'https://kassa.pmcp.dev')
})

test('a shared-package change fans out to every consuming app', () => {
  const r = computeMatrix({ event: 'push', changedFiles: ['pnpm-lock.yaml'], apps: APPS })
  assert.deepEqual(names(r).sort(), ['fanfare', 'triage', 'velo'])
})

test('a workflow-only change matches no app → empty matrix (legitimately, any=false)', () => {
  const r = computeMatrix({ event: 'push', changedFiles: ['.github/workflows/deploy-apps.yml'], apps: APPS })
  assert.deepEqual(names(r), [])
  assert.equal(r.any, false)
})

// ── computeMatrix: pull_request (rung split #1297) ────────────────────────────
test('a PR deploys ONLY the app whose own paths changed, ignoring shared-package changes', () => {
  const r = computeMatrix({
    event: 'pull_request',
    changedFiles: ['apps/triage/app/x.vue', 'packages/crouton-sales/y.ts'], // sales would match fanfare on a push
    apps: APPS
  })
  assert.deepEqual(names(r), ['triage']) // NOT fanfare — PRs don't fan out on shared pkgs
})

// ── computeMatrix: workflow_dispatch ──────────────────────────────────────────
test('dispatch honours production only for the explicit choice (#318 whitelist)', () => {
  assert.equal(computeMatrix({ event: 'workflow_dispatch', dispatchApp: 'fanfare', dispatchEnv: 'production', apps: APPS }).include[0].environment, 'production')
  assert.equal(computeMatrix({ event: 'workflow_dispatch', dispatchApp: 'fanfare', dispatchEnv: '', apps: APPS }).include[0].environment, 'staging')
  assert.equal(computeMatrix({ event: 'workflow_dispatch', dispatchApp: 'fanfare', dispatchEnv: 'prod', apps: APPS }).include[0].environment, 'staging') // typo ≠ production
})

test('dispatch for an unknown app yields an empty matrix', () => {
  assert.deepEqual(computeMatrix({ event: 'workflow_dispatch', dispatchApp: 'nope', apps: APPS }).include, [])
})

// ── resolveChangedFiles: the #1499 core (never a silent empty) ─────────────────
test('push prefers the first-parent diff (HEAD~1..HEAD)', () => {
  const git = fakeGit({ resolvable: ['HEAD~1'], diffs: { 'HEAD~1..HEAD': ['packages/crouton-sales/x.ts'] } })
  const r = resolveChangedFiles({ event: 'push', baseSha: 'deadbeef', headSha: 'cafe', git })
  assert.equal(r.source, 'push:first-parent')
  assert.deepEqual(r.files, ['packages/crouton-sales/x.ts'])
})

test('push falls back to before..after only when HEAD~1 is unavailable', () => {
  const git = fakeGit({ resolvable: ['base1'], diffs: { 'base1..head1': ['apps/velo/x.vue'] } })
  const r = resolveChangedFiles({ event: 'push', baseSha: 'base1', headSha: 'head1', git })
  assert.equal(r.source, 'push:before..after')
  assert.deepEqual(r.files, ['apps/velo/x.vue'])
})

test('push throws (does NOT return empty) when no base resolves — the #1499 silent-skip guard', () => {
  const git = fakeGit({ resolvable: [] }) // neither HEAD~1 nor the before-sha resolve
  assert.throws(() => resolveChangedFiles({ event: 'push', baseSha: 'ghost', headSha: 'head', git }), DetectError)
})

test('push with the all-zero before-sha and no HEAD~1 throws rather than emitting empty', () => {
  const git = fakeGit({ resolvable: [] })
  assert.throws(() => resolveChangedFiles({ event: 'push', baseSha: ZERO_SHA, headSha: 'head', git }), DetectError)
})

test('pull_request uses base..head', () => {
  const git = fakeGit({ resolvable: ['prbase'], diffs: { 'prbase..prhead': ['apps/triage/x.vue'] } })
  const r = resolveChangedFiles({ event: 'pull_request', baseSha: 'prbase', headSha: 'prhead', git })
  assert.equal(r.source, 'pr:base..head')
  assert.deepEqual(r.files, ['apps/triage/x.vue'])
})

test('pull_request throws when the PR base sha will not resolve (no silent empty)', () => {
  const git = fakeGit({ resolvable: [] })
  assert.throws(() => resolveChangedFiles({ event: 'pull_request', baseSha: 'ghost', headSha: 'head', git }), DetectError)
})
