// #3289 — the fallow 3.34.1 config rule, checked against the REAL binary and the REAL .fallowrc.json.
// Needs the installed `fallow` package, so it lives in the *.deps-test.mjs set (ci.yml, "Run scripts/*.deps-test.mjs").
//
// The rule: on 3.x the checker no longer reports hundreds of false "unused" files (3.x seeds far
// fewer entry points, and `*` no longer matches `/`), but it still catches a really dead file and a
// too-complex function. `fallow audit` is diff-scoped (0 changed files on a clean checkout), so it
// cannot prove this; these run the whole-project commands instead.
//
//   node --test scripts/fallow-config.deps-test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync, execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const FALLOW = join(ROOT, 'node_modules', '.bin', 'fallow')

function fallow (args, root = ROOT) {
  const r = spawnSync(FALLOW, [...args, '--root', root, '--format', 'json'], { cwd: root, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 })
  assert.equal(r.error, undefined, `could not run fallow: ${r.error}`)
  return { status: r.status, json: JSON.parse(r.stdout), stderr: r.stderr }
}

// A copy of the tracked + untracked-not-ignored tree, so scratch probes never touch the real
// checkout (other deps-tests run in parallel and read packages/*).
function repoCopy () {
  const dir = mkdtempSync(join(tmpdir(), 'fallow-3289-'))
  const files = execFileSync('git', ['ls-files', '-z', '-co', '--exclude-standard'], { cwd: ROOT }).toString().split('\0').filter(Boolean)
  execFileSync('tar', ['--null', '-T', '-', '-cf', join(dir, '.src.tar')], { cwd: ROOT, input: files.join('\0') })
  execFileSync('tar', ['-xf', '.src.tar'], { cwd: dir })
  rmSync(join(dir, '.src.tar'))
  return dir
}

function writeProbe (root, rel, body) {
  mkdirSync(dirname(join(root, rel)), { recursive: true })
  writeFileSync(join(root, rel), body)
}

test('the installed fallow is 3.34.1 (the epic #3288 pin)', () => {
  assert.equal(fallow(['dead-code']).json.version, '3.34.1')
})

// covers: T1
test('T1: fallow 3.34.1 reports 0 unused files and no "no longer matches" glob warning on the repo', () => {
  // Exit code is not the check: other categories (exports, cycles) are left to #3290.
  const { json, stderr } = fallow(['dead-code'])
  assert.deepEqual(json.unused_files.map(f => f.path), [], 'unused files reported')
  assert.equal(json.summary.unused_files, 0)
  assert.doesNotMatch(stderr, /no longer matches/i, 'a .fallowrc.json glob still relies on 2.x `*` matching `/`')
})

// covers: T3
test('T3: a dead file outside the auto-loaded dirs is still caught', () => {
  const dir = repoCopy()
  try {
    writeProbe(dir, 'packages/crouton-core/app/helpers/dead-probe.ts', 'export const deadProbe = 1\n')
    const { json } = fallow(['dead-code'], dir)
    assert.deepEqual(json.unused_files.map(f => f.path), ['packages/crouton-core/app/helpers/dead-probe.ts'])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

// covers: T4
test('T4: the complexity gate still fires on a 40-branch function in app/utils', () => {
  const dir = repoCopy()
  try {
    let body = 'export function probeComplex (n: number): number {\n'
    for (let i = 0; i < 40; i++) body += `  if (n === ${i}) return ${i}\n`
    body += '  return -1\n}\n'
    const rel = 'packages/crouton-core/app/utils/probeComplex.ts'
    writeProbe(dir, rel, body)
    const { status, json } = fallow(['health', '--complexity', rel], dir)
    assert.equal(status, 1, 'health should exit non-zero on a function above the thresholds')
    assert.ok(json.findings.some(f => f.path === rel && f.name === 'probeComplex'), 'probeComplex not flagged')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
