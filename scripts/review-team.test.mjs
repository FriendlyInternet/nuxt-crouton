// The review team a preview's login lands in (#4141): deploy.config.json `reviewTeam`,
// default test1, cross-checked against croutonAuth.teams.defaultTeamSlug.
//   node --test scripts/review-team.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, existsSync, mkdtempSync, writeFileSync } from 'node:fs'
import { execFileSync, spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { resolveReviewTeam, teamForAppDir, readDefaultTeamSlug } from './review-team.mjs'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const SCRIPT = join(ROOT, 'scripts/review-team.mjs')
const runCli = dir => spawnSync(process.execPath, [SCRIPT, dir], { encoding: 'utf8' })
const appDir = (files) => {
  const dir = mkdtempSync(join(tmpdir(), 'review-team-'))
  for (const [name, text] of Object.entries(files)) writeFileSync(join(dir, name), text)
  return dir
}

test('case 1: no reviewTeam key → test1', () => {
  assert.deepEqual(resolveReviewTeam({ manifest: {} }), { team: 'test1' })
  assert.deepEqual(resolveReviewTeam({}), { team: 'test1' })
  assert.deepEqual(resolveReviewTeam({ manifest: { seed: true }, nuxtConfigText: "defaultTeamSlug: 'test1'" }), { team: 'test1' })
})

test('corpus: every committed deploy.config.json (with its nuxt.config.ts) resolves to test1, no error', () => {
  const dirs = ['apps', 'pocs'].flatMap(ws => readdirSync(join(ROOT, ws)).map(a => join(ROOT, ws, a)))
    .filter(d => existsSync(join(d, 'deploy.config.json')))
  assert.ok(dirs.length >= 10, `expected the committed deploy configs, found ${dirs.length}`)
  for (const d of dirs) {
    const r = teamForAppDir(d)
    assert.equal(r.error, undefined, `${d}: ${r.error}`)
    assert.equal(r.team, 'test1', d)
  }
})

test('case 2: reviewTeam kdm → kdm', () => {
  assert.deepEqual(resolveReviewTeam({ manifest: { reviewTeam: 'kdm' } }), { team: 'kdm' })
  assert.deepEqual(resolveReviewTeam({ manifest: { reviewTeam: 'kdm' }, nuxtConfigText: "teams: { defaultTeamSlug: 'kdm' }" }), { team: 'kdm' })
  const dir = appDir({ 'deploy.config.json': '{"reviewTeam":"kdm"}', 'nuxt.config.ts': "defaultTeamSlug: \"kdm\"," })
  const r = runCli(dir)
  assert.equal(r.status, 0, r.stderr)
  assert.equal(r.stdout, 'kdm\n')
})

test('case 2: deploy-app.yml passes the resolved team to crouton-seed --team and --seed-team', () => {
  const yml = readFileSync(join(ROOT, '.github/workflows/deploy-app.yml'), 'utf8')
  assert.match(yml, /id: review_team[\s\S]*?scripts\/review-team\.mjs/)
  assert.match(yml, /crouton-seed --db "\$DB" --remote --team "\$\{\{ steps\.review_team\.outputs\.team \}\}"/)
  assert.match(yml, /REVIEW_TEAM: \$\{\{ steps\.review_team\.outputs\.team \}\}/)
  assert.match(yml, /--seed-team "\$REVIEW_TEAM"/)
  assert.doesNotMatch(yml, /--seed-team test1/)
  // The resolve step runs before both consumers.
  const at = s => yml.indexOf(s)
  assert.ok(at('id: review_team') < at('crouton-seed --db'), 'resolve before the seed')
  assert.ok(at('id: review_team') < at('--seed-team "$REVIEW_TEAM"'), 'resolve before the login')
})

test('case 4: key differs from defaultTeamSlug → error naming both; CLI exits 1', () => {
  const r = resolveReviewTeam({ manifest: { reviewTeam: 'kdm' }, nuxtConfigText: "croutonAuth: { teams: { defaultTeamSlug: 'test1' } }" })
  assert.match(r.error, /"kdm"/)
  assert.match(r.error, /"test1"/)
  const dir = appDir({ 'deploy.config.json': '{"reviewTeam":"kdm"}', 'nuxt.config.ts': "defaultTeamSlug: 'test1'" })
  const cli = runCli(dir)
  assert.equal(cli.status, 1)
  assert.match(cli.stderr, /::error::deploy\.config\.json reviewTeam "kdm" ≠ croutonAuth\.teams\.defaultTeamSlug "test1"/)
  assert.equal(cli.stdout, '')
})

test('an invalid slug is refused', () => {
  assert.match(resolveReviewTeam({ manifest: { reviewTeam: 'Kdm!' } }).error, /not a valid team slug/)
  assert.match(resolveReviewTeam({ manifest: { reviewTeam: 42 } }).error, /not a valid team slug/)
  assert.equal(runCli(appDir({ 'deploy.config.json': '{"reviewTeam":"a b"}' })).status, 1)
})

test('no key + a different defaultTeamSlug → warning only, team stays test1', () => {
  const r = resolveReviewTeam({ manifest: {}, nuxtConfigText: "defaultTeamSlug: 'kvr'" })
  assert.equal(r.team, 'test1')
  assert.equal(r.error, undefined)
  assert.match(r.warning, /"kvr"/)
  const cli = runCli(appDir({ 'nuxt.config.ts': "defaultTeamSlug: 'kvr'" }))
  assert.equal(cli.status, 0)
  assert.equal(cli.stdout, 'test1\n')
  assert.match(cli.stderr, /::warning::/)
})

test('a computed defaultTeamSlug skips the cross-check', () => {
  assert.equal(readDefaultTeamSlug('defaultTeamSlug: process.env.TEAM'), null)
  assert.deepEqual(resolveReviewTeam({ manifest: { reviewTeam: 'kdm' }, nuxtConfigText: 'defaultTeamSlug: process.env.TEAM' }), { team: 'kdm' })
})

test('pnpm preview path: teamForAppDir reads the app dir (fake reader), missing file → test1', () => {
  const files = { 'x/deploy.config.json': '{"reviewTeam":"kdm"}' }
  const read = (p) => { if (p in files) return files[p]; throw new Error('ENOENT') }
  assert.equal(teamForAppDir('x', read).team, 'kdm')
  assert.equal(teamForAppDir('nope', read).team, 'test1')
  assert.equal(teamForAppDir('bad', () => '{not json').team, 'test1')
})

test('CLI with no dir → usage, exit 2', () => {
  assert.throws(() => execFileSync(process.execPath, [SCRIPT], { stdio: 'pipe' }), e => e.status === 2)
})
