// The epic's numbers for its postmortem (#3253) — computed from the run records, never by the model.
// The fixture is shaped like closed epic #3714: child #3715 (PR #3719 → main), child #3716 closed not
// planned with no runs. Hand count from the real records: 8 runs, 1 silent fix-ci, 1 plan round,
// 2 build rounds, 2 revises.
//   node --test scripts/lib/epic-numbers.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { epicNumbers, childFor, buildPrToIssue, renderNumbers, renderNumbersFailed, extractTicketSteps } from './epic-numbers.mjs'
import { runEpicNumbers } from '../epic-numbers-run.mjs'

const run = (id, stage, extra = {}) => ({
  run_id: id, attempt: '1', stage, workflow: `${stage}.yml`, produced: ['comment'],
  ref: `https://github.com/o/r/actions/runs/${id}`, ...extra
})
// The 8 real records for #3715 / PR #3719. build-review / fix-ci / revise carry only `pr`.
const RECORDS_3714 = [
  run('42855906758', 'plan', { issue: 3715 }),
  run('42857128637', 'plan-review', { issue: 3715 }),
  run('42858393263', 'work', { issue: 3715, pr: 3719 }),
  run('42861224531', 'fix-ci', { pr: 3719, produced: ['nothing'] }),
  run('42861627538', 'revise', { pr: 3719 }),
  run('42864083660', 'build-review', { pr: 3719 }),
  run('42864560123', 'revise', { pr: 3719 }),
  run('42866192099', 'build-review', { pr: 3719 }),
  run('99', 'work', { issue: 4000, pr: 4001 }) // another epic's run: not counted
]
const CHILDREN_3714 = [
  { number: 3715, prs: [] }, // the PR is found through the work record
  { number: 3716, prs: [] }
]
const owner = (body, url = 'u') => ({ body, user: { login: 'pmcp' }, html_url: url })

test('T1: a #3715-shaped epic → 8 runs, 1 silent fix-ci, 1 plan round, 2 build rounds', () => {
  const n = epicNumbers({ epic: 3714, epicCreatedAt: '2026-11-10T10:00:00Z', children: CHILDREN_3714, records: RECORDS_3714 })
  assert.equal(n.runs, 8)
  assert.equal(n.silent.length, 1)
  assert.deepEqual(n.silent[0], { ref: 'https://github.com/o/r/actions/runs/42861224531', workflow: 'fix-ci.yml', stage: 'fix-ci', child: 3715 })
  assert.deepEqual(n.perChild[0], { issue: 3715, runs: 8, planRounds: 1, buildRounds: 2, revises: 2, silent: 1 })
  assert.deepEqual(n.perChild[1], { issue: 3716, runs: 0, planRounds: 0, buildRounds: 0, revises: 0, silent: 0 })
})

test('T1: a pr-only build-review record is credited to the child through the work record', () => {
  const prToIssue = buildPrToIssue(RECORDS_3714, CHILDREN_3714)
  assert.equal(prToIssue[3719], 3715)
  assert.equal(childFor({ stage: 'build-review', pr: 3719 }, prToIssue, new Set([3715, 3716])), 3715)
  assert.equal(childFor({ stage: 'build-review', pr: 4001 }, prToIssue, new Set([3715, 3716])), null)
  // the PRs found per child count too, even with no work record
  assert.equal(buildPrToIssue([], [{ number: 3716, prs: [{ number: 5000 }] }])[5000], 3716)
})

test('T1: the same run listed twice is counted once', () => {
  const n = epicNumbers({ epic: 3714, children: CHILDREN_3714, records: [...RECORDS_3714, RECORDS_3714[0]] })
  assert.equal(n.runs, 8)
})

test('T1: an owner `ok` is not a touch, an owner question is; an interactive 🤖 owner comment is viaAgent', () => {
  const n = epicNumbers({
    epic: 3714, children: CHILDREN_3714, records: RECORDS_3714,
    ownerComments: [
      owner('ok'),
      owner('why does this skip the generator?', 'q'),
      owner('> 🤖 **Claude Code** · posted from pmcp\n\nfollow-up', 'a'),
      { body: 'question from someone else', user: { login: 'x' } }
    ]
  })
  assert.deepEqual(n.ownerTouches, { typed: 1, viaAgent: 1, links: ['q', 'a'] })
})

test('T1: time to main = epic created → the latest merge to main; null when never merged', () => {
  const children = [{ number: 3715, prs: [{ number: 3719, baseRef: 'main', mergedAt: '2026-11-10T22:00:00Z' }] }]
  assert.equal(epicNumbers({ epic: 3714, epicCreatedAt: '2026-11-10T10:00:00Z', children }).timeToMainHours, 12)
  const toEpic = [{ number: 3715, prs: [{ number: 3719, baseRef: 'epic/3714-x', mergedAt: '2026-11-10T22:00:00Z' }] }]
  assert.equal(epicNumbers({ epic: 3714, epicCreatedAt: '2026-11-10T10:00:00Z', children: toEpic }).timeToMainHours, null)
})

test('T1: the numbers block — summary line, per-child table, silent runs as links', () => {
  const md = renderNumbers(epicNumbers({ epic: 3714, children: CHILDREN_3714, records: RECORDS_3714 }))
  assert.match(md, /^### 📊 Numbers/)
  assert.match(md, /\*\*8 runs\*\* · \*\*1 silent\*\*/)
  assert.match(md, /\| #3715 \| 8 \| 1 \| 2 \| 2 \| 1 \|/)
  assert.match(md, /\[fix-ci #3715\]\(https:\/\/github\.com\/o\/r\/actions\/runs\/42861224531\)/)
})

test('T1: empty records render "no run records", never made-up zeros', () => {
  const md = renderNumbers(epicNumbers({ epic: 2906, children: [{ number: 2911, prs: [] }], records: [] }))
  assert.match(md, /No run records for this epic \(records start 2026-11-04\)/)
  assert.doesNotMatch(md, /0 runs|\| #2911 \|/)
})

test('renderNumbersFailed names the reason and the run, and says the epic is not held up', () => {
  const s = renderNumbersFailed({ reason: 'pipeline-data was not fetched', runUrl: 'https://x/run/1' })
  assert.match(s, /^📊 \*\*Numbers didn't run\*\* — pipeline-data was not fetched \(\[the run\]\(https:\/\/x\/run\/1\)\)\. The epic is not held up by it\.$/)
})

// #2911's real body (trimmed to its sections): six numbered `Do` steps, code spans kept.
const BODY_2911 = [
  'Blocked-by: #2907', '', '## What', '`lib/generate-collection.ts:765` tests `f.type`.', '',
  '## Do',
  '1. `packages/crouton-editor/crouton.manifest.ts`: declare `fieldTypes.richText`.',
  '2. The manifest loader already merges package `fieldTypes`; verify `getTypeMapping()` includes it.',
  "3. Keep `generate-collection.ts:765`'s check, now reachable; translatable `richText` fields go in the translations JSON like `text`.",
  '4. `crouton-bookings/schemas/location.json`: `"component": "EditorSimple"` → `"CroutonEditorSimple"`.',
  '5. Docs: `.claude/skills/crouton.md` field-types table + `packages/crouton-cli/CLAUDE.md`.',
  '6. Tests included: a schema with a `richText` field generates `CroutonEditorSimple` in `_Form.vue`.',
  '', '## Test', 'In `fixtures/with-pages` add `"type": "richText"` and run the generator.', '',
  '```', '1. not a step (inside a fence)', '```'
].join('\n')

test('T1: extractTicketSteps returns #2911\'s six Do steps, code spans kept', () => {
  const steps = extractTicketSteps(BODY_2911)
  assert.equal(steps.length, 6)
  assert.deepEqual(steps.map(s => s.n), [1, 2, 3, 4, 5, 6])
  assert.ok(steps.every(s => s.section === 'Do'))
  assert.equal(steps[2].text, "Keep `generate-collection.ts:765`'s check, now reachable; translatable `richText` fields go in the translations JSON like `text`.")
})

test('extractTicketSteps: bullets under 🤖 For agents and 🧪 How to test; other sections ignored', () => {
  const steps = extractTicketSteps('## 👤 For humans\n- not a step\n## 🤖 For agents\n- a\n- b\n## 🧪 How to test\n1. run it\n2. check it\n')
  assert.deepEqual(steps, [
    { section: '🤖 For agents', n: 1, text: 'a' }, { section: '🤖 For agents', n: 2, text: 'b' },
    { section: '🧪 How to test', n: 1, text: 'run it' }, { section: '🧪 How to test', n: 2, text: 'check it' }
  ])
})

// The CLI the workflow runs, with a fake `gh` (no network in CI's node --test job).
function fakeGh() {
  const calls = []
  const gh = args => {
    calls.push(args.join(' '))
    const a = args.join(' ')
    if (a === 'api repos/o/r/issues/3714') return JSON.stringify({ number: 3714, created_at: '2026-11-10T10:00:00Z' })
    if (a.includes('issues/3714/sub_issues')) {
      return [
        { number: 3715, title: 'quiz', state: 'closed', body: '## Do\n1. one\n2. two\n<!-- pipeline: epic=3714 epic_branch=epic/3714-quiz -->' },
        { number: 3716, title: 'other', state: 'closed', state_reason: 'not_planned', body: '' }
      ].map(x => JSON.stringify(x)).join('\n')
    }
    if (a.includes('--search #3715 in:body')) return JSON.stringify([{ number: 3719, baseRefName: 'main', mergedAt: '2026-11-10T22:00:00Z', body: 'Closes #3715\n' }])
    // a plain body search also matches a mention: #3989 belongs to another issue
    if (a.includes('--search #3716 in:body')) return JSON.stringify([{ number: 3989, baseRefName: 'main', body: 'Closes #3780\nsee #3716' }])
    if (a.includes('--head epic/3714-quiz')) return '[]'
    if (a.includes('/comments')) return a.includes('issues/3714/') ? JSON.stringify({ body: 'why?', user: { login: 'pmcp' }, html_url: 'c1' }) : ''
    throw new Error(`unexpected gh ${a}`)
  }
  return { gh, calls }
}
const recordsDir = () => {
  const d = join(mkdtempSync(join(tmpdir(), 'rec-')), 'records')
  mkdirSync(join(d, '2026-11-10'), { recursive: true })
  for (const r of RECORDS_3714) writeFileSync(join(d, '2026-11-10', `${r.run_id}-1.json`), JSON.stringify(r))
  return d
}

test('CLI: real records + gh → numbers.json, numbers.md, steps.md; a mention-only PR is not credited', async () => {
  const out = mkdtempSync(join(tmpdir(), 'num-'))
  const { gh } = fakeGh()
  const r = await runEpicNumbers({ epic: '3714', outDir: out, recordsDir: recordsDir(), env: { GITHUB_REPOSITORY: 'o/r' }, gh })
  assert.equal(r, 'ok')
  const n = JSON.parse(readFileSync(join(out, 'numbers.json'), 'utf8'))
  assert.equal(n.runs, 8)
  assert.equal(n.timeToMainHours, 12)
  assert.deepEqual(n.ownerTouches, { typed: 1, viaAgent: 0, links: ['c1'] })
  assert.match(readFileSync(join(out, 'numbers.md'), 'utf8'), /\*\*8 runs\*\*/)
  const steps = readFileSync(join(out, 'steps.md'), 'utf8')
  assert.match(steps, /## #3715 — quiz \(closed\)\nPRs: #3719 \(merged → main\)/)
  assert.match(steps, /- \[Do 2\] two/)
  assert.match(steps, /## #3716 — other \(closed, not_planned\)\nPRs: none found/)
  assert.ok(!existsSync(join(out, 'numbers-failed.txt')))
})

test('CLI: SIMULATE_NUMBERS_FAILURE, or no records, writes numbers-failed.txt and never throws', async () => {
  const out = mkdtempSync(join(tmpdir(), 'num-'))
  assert.equal(await runEpicNumbers({ epic: '3714', outDir: out, recordsDir: recordsDir(), env: { SIMULATE_NUMBERS_FAILURE: 'true' }, gh: fakeGh().gh }), 'failed')
  assert.match(readFileSync(join(out, 'numbers-failed.txt'), 'utf8'), /simulate_numbers_failure/)
  const out2 = mkdtempSync(join(tmpdir(), 'num-'))
  assert.equal(await runEpicNumbers({ epic: '3714', outDir: out2, recordsDir: join(out2, 'nope'), env: { GITHUB_REPOSITORY: 'o/r' }, gh: fakeGh().gh }), 'failed')
  assert.match(readFileSync(join(out2, 'numbers-failed.txt'), 'utf8'), /pipeline-data was not fetched/)
  assert.ok(!existsSync(join(out2, 'numbers.md')))
})
