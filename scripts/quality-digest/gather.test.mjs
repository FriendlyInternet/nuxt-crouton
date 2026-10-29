import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  classifyArea,
  classifyKind,
  countComments,
  isRevertSubject,
  parseArgs,
  scanWorkflows,
  touchesClaudeMd,
  touchesTests
} from './gather.mjs'

test('area: majority of changed lines decides', () => {
  assert.equal(classifyArea([{ filename: '.github/workflows/a.yml', additions: 10, deletions: 0 }, { filename: 'packages/x/a.ts', additions: 3, deletions: 0 }]), 'pipeline')
  assert.equal(classifyArea([{ filename: 'scripts/a.mjs', additions: 1, deletions: 0 }, { filename: 'apps/x/a.vue', additions: 5, deletions: 5 }]), 'product')
  assert.equal(classifyArea([{ filename: 'writeups/a.md', additions: 9, deletions: 0 }]), 'other')
  assert.equal(classifyArea([]), 'other')
})

test('kind from head ref', () => {
  assert.equal(classifyKind('work-12'), 'leaf')
  assert.equal(classifyKind('fix/thing'), 'leaf')
  assert.equal(classifyKind('epic/3-x'), 'epic')
  assert.equal(classifyKind('feature/x'), null)
})

test('comment counters', () => {
  const c = countComments(['**Worker:** r1', '**Worker:** r2', 'Auto-fix not pushed: x', 'tests: MISSING', 'visual evidence: MISSING', null])
  assert.deepEqual(c, { reviseRounds: 2, fixBotRefusals: 1, testsMissingDraft: true, visualEvidenceMissing: true })
  assert.deepEqual(countComments([]), { reviseRounds: 0, fixBotRefusals: 0, testsMissingDraft: false, visualEvidenceMissing: false })
})

test('path and subject matchers', () => {
  assert.ok(touchesClaudeMd(['packages/a/CLAUDE.md']))
  assert.ok(touchesClaudeMd(['CLAUDE.md']))
  assert.ok(!touchesClaudeMd(['packages/a/NOTCLAUDE.md']))
  assert.ok(touchesTests(['a/b.test.ts']) && touchesTests(['x/tests/y.ts']) && !touchesTests(['a/b.ts']))
  assert.ok(isRevertSubject('Revert "x"') && isRevertSubject('restore y') && !isRevertSubject('feat: add'))
})

test('window defaults to 7 days before until', () => {
  assert.deepEqual(parseArgs([], new Date('2026-10-29T10:00:00Z')), { since: '2026-10-22', until: '2026-10-29' })
  assert.deepEqual(parseArgs(['--since', '2026-01-01', '--until', '2026-01-08']), { since: '2026-01-01', until: '2026-01-08' })
})

const wf = (body) => ({ name: 'w.yml', text: `name: w\non: push\njobs:\n${body}` })

test('scan: artifact upload with db-ish path', () => {
  const bad = wf(`  a:
    steps:
      - uses: actions/upload-artifact@v1
        with:
          name: x
          path: teardown-backups/
`)
  const ok = wf(`  a:
    steps:
      - uses: actions/upload-artifact@v1
        with:
          path: dist/
`)
  assert.equal(scanWorkflows([bad]).artifactUploadsWithDbPaths.length, 1)
  assert.equal(scanWorkflows([ok]).artifactUploadsWithDbPaths.length, 0)
})

test('scan: model job with persisted credentials', () => {
  const bad = wf(`  a:
    steps:
      - uses: actions/checkout@v4
      - name: go
        run: pi -p "do it"
`)
  const ok = wf(`  a:
    steps:
      - uses: actions/checkout@v4
        with:
          persist-credentials: false
      - run: pi -p "do it"
`)
  const noModel = wf(`  a:
    steps:
      - uses: actions/checkout@v4
      - run: pnpm test
`)
  assert.deepEqual(scanWorkflows([bad]).modelJobsWithCredentials, [{ workflow: 'w.yml', job: 'a' }])
  assert.equal(scanWorkflows([ok]).modelJobsWithCredentials.length, 0)
  assert.equal(scanWorkflows([noModel]).modelJobsWithCredentials.length, 0)
})

test('scan: comment body interpolated in run', () => {
  const bad = wf(`  a:
    steps:
      - name: x
        run: |
          echo "\${{ github.event.comment.body }}"
`)
  const ok = wf(`  a:
    steps:
      - name: x
        env:
          BODY: \${{ github.event.comment.body }}
        run: echo "$BODY"
`)
  assert.equal(scanWorkflows([bad]).commentBodyInRun.length, 1)
  assert.equal(scanWorkflows([ok]).commentBodyInRun.length, 0)
})

test('scan: fail-open gate', () => {
  const bad = wf(`  a:
    steps:
      - name: Review verdict
        continue-on-error: true
        run: echo
      - name: Lint
        continue-on-error: true
        run: echo
`)
  const r = scanWorkflows([bad]).failOpenGates
  assert.equal(r.length, 1)
  assert.equal(r[0].step, 'Review verdict')
})
