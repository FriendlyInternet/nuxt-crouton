import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { logTail, cleanLine, failingLines, stoppedAtBlock, NOISE_LINES, EXIT_LINE } from './log-tail.mjs'

const fixture = name => readFileSync(new URL(`./__fixtures__/ci-logs/${name}`, import.meta.url), 'utf8')

const ts = '2026-10-26T10:00:00.1234567Z '

test('logTail: returns empty for empty input', () => {
    assert.deepEqual(logTail(''), { text: '', truncated: false })
    assert.deepEqual(logTail(undefined), { text: '', truncated: false })
  })

test('logTail: strips timestamps and group markers', () => {
    const out = logTail(`${ts}##[group]Run x\n${ts}hello\n${ts}##[endgroup]\n`)
    assert.equal(out.text, 'hello')
    assert.equal(out.truncated, false)
  })

test('logTail: anchors on the last ##[error] and drops what follows', () => {
    const log = [`${ts}a`, `${ts}error TS2322: bad`, `${ts}##[error]Process completed with exit code 1.`, `${ts}Post job cleanup.`].join('\n')
    const { text: out, truncated } = logTail(log)
    assert.equal(truncated, false)
    assert.equal(out.endsWith('##[error]Process completed with exit code 1.'), true)
    assert.match(out, /error TS2322: bad/)
    assert.doesNotMatch(out, /cleanup/)
  })

test('logTail: falls back to the last lines without an ##[error]', () => {
    const log = Array.from({ length: 10 }, (_, i) => `l${i}`).join('\n')
    const r = logTail(log, { maxLines: 3 })
    assert.equal(r.text, 'l7\nl8\nl9')
    assert.equal(r.truncated, true)
  })

test('logTail: respects maxLines and maxBytes', () => {
    const log = Array.from({ length: 200 }, (_, i) => `line ${i}`).join('\n') + '\n##[error]boom'
    assert.equal(logTail(log, { maxLines: 5 }).text.split('\n').length, 5)
    const { text: small, truncated } = logTail(log, { maxBytes: 50 })
    assert.equal(truncated, true)
    assert.ok(Buffer.byteLength(small) <= 50)
    assert.equal(small.endsWith('##[error]boom'), true)
  })

// Trimmed real job logs from #3666 — the first line each must report, exactly.
const EXPECTED = {
  'pr3661-node-checks.txt': 'not ok 572 - committed api-reference pages match the code',
  'pr3522-node-checks.txt': "not ok 567 - every label description fits GitHub's 100-character limit",
  'pr3237-node-checks.txt': 'not ok 339 - approve-epic says `ok`, never `lgtm`, and never enables GitHub auto-merge',
  'pr3589-node-checks.txt': 'not ok 830 - record-outcome: runs after every other job, even failed or cancelled ones',
  'pr3472-node-checks.txt': 'not ok 1520 - corpus: committed baseline covers the real tree',
  'pr3632-typecheck-poc.txt': '##[error]ReferenceError: getQuery is not defined',
}
const FIXTURES = [...Object.keys(EXPECTED), 'pr3632-deploy-staging.txt']

for (const [name, first] of Object.entries(EXPECTED)) {
  test(`failingLines: ${name} → its expected first cause`, () => {
    assert.equal(failingLines(fixture(name))[0]?.text, first)
  })
}

test('failingLines: pr3472 reports its second failure too', () => {
  assert.ok(failingLines(fixture('pr3472-node-checks.txt'))[1].text.startsWith('not ok 1535 - '))
})

test('failingLines: pr3632-deploy-staging → the RollupError, not the TS2742 build warnings', () => {
  const first = failingLines(fixture('pr3632-deploy-staging.txt'))[0].text
  assert.ok(first.startsWith('[error] [nitro] RollupError: ../../scripts/approval.mjs (1:1): Expected ident'), first)
})

test('NOISE_LINES: every entry matches its own evidence line', () => {
  const evidence = [
    { re: NOISE_LINES[0], file: 'pr3632-deploy-staging.txt', has: "error TS2742: The inferred type of 'createNuxtMocks'", hits: 2 },
    { re: NOISE_LINES[1], file: 'pr3632-typecheck-poc.txt', has: 'Resolve plugin path failed: vue-router/volar/sfc-route-blocks', hits: 1 },
  ]
  assert.equal(NOISE_LINES.length, evidence.length, 'every NOISE_LINES entry needs a row here')
  for (const { re, file, has, hits } of evidence) {
    const lines = fixture(file).split(/\r?\n/).map(cleanLine).filter(l => l.includes(has))
    assert.equal(lines.length, hits, `${file} must keep its ${hits} evidence line(s)`)
    for (const l of lines) assert.ok(re.test(l), `${re} does not match its evidence: ${l.slice(0, 120)}`)
  }
})

test('failingLines: never returns a noise line or the exit-code line', () => {
  for (const name of FIXTURES) {
    const raw = fixture(name)
    assert.ok(raw.split('\n').map(cleanLine).some(l => EXIT_LINE.test(l)), `${name} keeps its exit line`)
    for (const { text } of failingLines(raw, { max: 50 })) {
      assert.ok(!EXIT_LINE.test(text), `${name}: ${text}`)
      assert.ok(!NOISE_LINES.some(re => re.test(text)), `${name}: ${text}`)
    }
  }
})

test('failingLines: a noise line that starts with ##[error] is still skipped', () => {
  const log = `${ts}##[error]packages/crouton-core build: x.ts(8,17): error TS2742: The inferred type\n${ts}not ok 1 - real`
  assert.deepEqual(failingLines(log).map(l => l.text), ['not ok 1 - real'])
})

test('failingLines: a passing test named "not ok" is not a cause', () => {
  assert.deepEqual(failingLines(`${ts}ok 834 - a later not ok cancels an earlier ok\n`), [])
})

test('failingLines: strips timestamps/ANSI, numbers raw lines, de-dups, honours max', () => {
  const log = [
    `${ts}##[group]Run tests`,
    `${ts}\x1b[31mnot ok 1 - a\x1b[0m`,
    `${ts}##[endgroup]`,
    `${ts}not ok 1 - a`,
    `${ts}  error TS2322: bad`,
    `${ts}^[[31m ERR_PNPM_RECURSIVE_RUN_FIRST_FAIL x`,
    `${ts}##[error]Process completed with exit code 1.`,
  ].join('\n')
  assert.deepEqual(failingLines(log), [
    { line: 2, text: 'not ok 1 - a' },
    { line: 5, text: '  error TS2322: bad' },
    { line: 6, text: ' ERR_PNPM_RECURSIVE_RUN_FIRST_FAIL x' },
  ])
  assert.equal(failingLines(log, { max: 1 }).length, 1)
})

test('failingLines: no cause → []', () => {
  assert.deepEqual(failingLines(''), [])
  assert.deepEqual(failingLines(undefined), [])
  assert.deepEqual(failingLines(`${ts}"base_is_epic"\n${ts}##[error]Process completed with exit code 1.`), [])
})

test('stoppedAtBlock: empty → \'\', else a fence with line numbers and neutralised backticks', () => {
  assert.equal(stoppedAtBlock([]), '')
  assert.equal(stoppedAtBlock([{ line: 7, text: 'not ok 1 - ```x```' }]), "Stopped at:\n```\n7: not ok 1 - '''x'''\n```\n")
})

test('logTail: strips ANSI colour codes, real and rendered', () => {
  const out = logTail(`${ts}\x1b[36;1mpnpm test\x1b[0m\n${ts}^[[36;1mrun\n${ts}##[error]x`)
  assert.equal(out.text, 'pnpm test\nrun\n##[error]x')
})
