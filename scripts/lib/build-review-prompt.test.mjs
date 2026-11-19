// node --test scripts/lib/build-review-prompt.test.mjs — the build reviewer's prompt takes CI's
// plan-checks table for THIS commit as fact (#3196).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { main, renderPrompt, findChecksTable, parseChecksTable } from './build-review-prompt.mjs'
import { renderComment } from '../plan-checks.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const PERSONA_PATH = join(ROOT, '.claude/agents/build-reviewer.md')
const PERSONA = readFileSync(PERSONA_PATH, 'utf8')
const WORKFLOW = readFileSync(join(ROOT, '.github/workflows/build-review.yml'), 'utf8')
const SHA = 'abc1234def5678'
const VARS = { issue: '3196', pr: '42', verdict_file: '/t/verdict.md', issue_file: '/t/issue.md', plan_file: '/t/plan.md', diff_file: '/t/diff.patch' }

const row = (id, status, what = `rule ${id}`) => ({ id, what, status, exit: status === 'manual' ? null : status === 'pass' ? 0 : 1, detail: status === 'manual' ? 'by hand' : 'node --test x', tail: '' })
const ciComment = (results, { sha = SHA, login = 'github-actions[bot]' } = {}) =>
  ({ user: { login }, body: renderComment({ results, sha, planUrl: 'https://x/plan' }) })

const fixture = (comments) => {
  const dir = mkdtempSync(join(tmpdir(), 'brp-'))
  const vars = join(dir, 'vars.json'); const com = join(dir, 'comments.json')
  writeFileSync(vars, JSON.stringify(VARS)); writeFileSync(com, JSON.stringify([comments])) // gh --slurp → [[…]]
  return { vars, com }
}
const render = (comments) => {
  const { vars, com } = fixture(comments)
  let out = ''
  main([PERSONA_PATH, '--vars', vars, '--comments', com, '--sha', SHA], { write: (s) => { out = s } })
  return out
}

// covers: T1
test('T1: an all-✅ CI table for this sha is stated as fact; nothing left unfilled', () => {
  const out = render([ciComment([row('T1', 'pass'), row('T2', 'pass')])])
  assert.match(out, /ran these Run: lines on this exact commit and every one exited 0 — that is a FACT: T1, T2\./)
  assert.match(out, /Do not check, and never FAIL item 1 over, whether they ran/)
  assert.doesNotMatch(out, /\{\{\w+\}\}/)
  assert.doesNotMatch(out, /No CI plan-checks table/)
})

// covers: T2
test('T2: a human-posted table or one for another sha is ignored → fallback text', () => {
  const human = ciComment([row('T1', 'pass')], { login: 'mallory' })
  const stale = ciComment([row('T1', 'pass')], { sha: '9999999aaaa' })
  for (const comments of [[human], [stale], [human, stale], []]) {
    const out = render(comments)
    assert.match(out, /No CI plan-checks table for this commit — judge from the diff and the CI logs/)
    assert.doesNotMatch(out, /that is a FACT/)
  }
  // the newest matching CI comment wins over an older one
  const older = ciComment([row('T1', 'fail')]); const newer = ciComment([row('T1', 'pass')])
  assert.equal(findChecksTable([[older, newer]], SHA), newer.body)
})

// covers: T3
test('T3: 🖐 rows are named for the owner, not as passed; a ❌ row makes item 1 FAIL', () => {
  const out = render([ciComment([row('T1', 'pass'), row('T2', 'fail'), row('T3', 'manual')])])
  assert.match(out, /that is a FACT: T1\./)
  assert.match(out, /Manual lines \(CI does not run them; the owner checks them by hand\): T3 — .*"owner checks by hand: T3"/)
  assert.match(out, /CI recorded these as FAILED: T2 — item 1 is FAIL\./)
  const rows = parseChecksTable(ciComment([row('T9', 'manual', 'a | b')]).body)
  assert.deepEqual(rows, [{ id: 'T9', what: 'a | b', result: 'manual' }])
})

// covers: T4
test('T4: apart from {{plan_checks}}, main() matches the legacy awk+sed rendering', () => {
  const out = render([])
  const legacy = execFileSync('bash', ['-c', `awk '/^---$/ && n < 2 { n++; next } n >= 2' "$1" | sed -e "s#{{issue}}#3196#g" -e "s#{{pr}}#42#g" -e "s#{{verdict_file}}#/t/verdict.md#g" -e "s#{{issue_file}}#/t/issue.md#g" -e "s#{{plan_file}}#/t/plan.md#g" -e "s#{{diff_file}}#/t/diff.patch#g"`, '_', PERSONA_PATH], { encoding: 'utf8' })
  const block = renderPrompt('{{plan_checks}}', {}, '')
  assert.equal(out, legacy.replace('{{plan_checks}}', block))
  for (const v of Object.values(VARS)) assert.ok(out.includes(v), v)
  assert.ok(!out.startsWith('---'))
})

// covers: T5
test('T5: persona item 1 carries {{plan_checks}}; workflow renders via trusted default-branch copies, no awk', () => {
  const item1 = PERSONA.split('\n').find((l) => l.startsWith('1. Rule held:'))
  assert.ok(item1 && item1.includes('{{plan_checks}}'), 'item 1 has the slot')
  assert.equal(PERSONA.split('{{plan_checks}}').length, 2, 'exactly one slot')
  const pi = WORKFLOW.slice(WORKFLOW.indexOf('      - id: pi\n'), WORKFLOW.indexOf('- name: Post the verdict'))
  assert.match(pi, /git archive "\$DEF" scripts \| tar -x -C "\$RUNNER_TEMP\/trusted"/)
  assert.match(pi, /node "\$RUNNER_TEMP\/trusted\/scripts\/lib\/build-review-prompt\.mjs"[^\n]*\\\n[^\n]*--sha "\$SHA"/)
  assert.doesNotMatch(pi, /\bawk\b/)
  assert.match(WORKFLOW, /issues\/\$\{PR\}\/comments\?per_page=100" > "\$D\/pr-comments\.json"/)
})

// covers: T2
test('doc-mentions (#4064) T2: item 7 (c) fails a missing fixed line and passes Debt, none, could not run and no comment', () => {
  const out = render([])
  const line = out.split('\n').find((l) => l.startsWith('7. Docs:'))
  assert.ok(line, 'rendered prompt has item 7')
  assert.ok(line.includes('(c)'), 'item 7 has a part (c)')
  const c = line.slice(line.indexOf('(c)'))
  assert.ok(c.includes('<!-- doc-mentions -->'))
  assert.match(c, /Each line marked `fixed` must be edited in the diff, or FAIL/)
  assert.match(c, /A `Debt:` line, `none` or `could not run` passes/)
  assert.match(c, /No such comment → this part passes/)
  assert.doesNotMatch(c, /Debt:[^.]*FAIL/)
})
