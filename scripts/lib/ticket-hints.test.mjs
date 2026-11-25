import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync, mkdtempSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync, spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { namedTickets, codeRules, hintNotes, ghStateOf, CAP } from './ticket-hints.mjs'

const CLI = fileURLToPath(new URL('./ticket-hints.mjs', import.meta.url))
const ROOT = fileURLToPath(new URL('../../', import.meta.url))
const fx = (n) => ({ number: n, body: readFileSync(fileURLToPath(new URL(`./__fixtures__/ticket-hints/${n}.md`, import.meta.url)), 'utf8') })
const allOpen = () => 'open'
const nums = (hits) => hits.map((h) => h.n)

test('T1: the real hidden dependencies are listed (#4418→#4375, #4434→#4376, #4441→#4418)', () => {
  assert.deepEqual(namedTickets(fx(4418), { epic: 4423, stateOf: allOpen }), [{ n: 4375, where: 'outside', state: 'open' }])
  assert.deepEqual(namedTickets(fx(4434), { epic: 4435, stateOf: allOpen }), [{ n: 4376, where: 'outside', state: 'open' }])
  assert.deepEqual(namedTickets(fx(4441), { epic: 4442, stateOf: allOpen }), [{ n: 4418, where: 'outside', state: 'open' }])
  assert.match(hintNotes([fx(4441)], { epic: 4442, stateOf: allOpen }), /### Ticket #4441\nOpen tickets it names that are not on its Blocked-by line:\n- #4418 \(outside this epic, open\)/)
})

test('T2: a split naming its own parts lists nothing; #4441 does not list #4451–#4453', () => {
  assert.deepEqual(namedTickets(fx(4425), { epic: 1, stateOf: allOpen }), [])
  assert.deepEqual(namedTickets(fx(4439), { epic: 1, stateOf: allOpen }), [])
  const n = nums(namedTickets(fx(4441), { epic: 4442, stateOf: allOpen }))
  for (const part of [4451, 4452, 4453]) assert.ok(!n.includes(part), String(part))
})

test('T3: Blocked-by, Dedup-checked/Related/Part of/Closes lines, HTML comments, the epic and the ticket itself are not listed', () => {
  const body = [
    'Blocked-by: #5001',
    'This needs #5001 first.',
    '_Dedup-checked: searched «x» → #5002_',
    '- **Related:** #5003',
    'Part of #5004',
    'Closes #5005',
    '<!-- pipeline: epic=#5006 step=1',
    'and #5007 here -->',
    'The epic #900 and this ticket #901.',
    '## Related',
    '- #5008 (same helper)',
    '## Notes',
  ].join('\n')
  assert.deepEqual(namedTickets({ number: 901, body }, { epic: 900, stateOf: allOpen }), [])
})

test('T4: a closed sibling and a closed outside ticket are dropped; no state → "state unknown"', () => {
  const t = { number: 10, body: 'Needs #6001, #6002, #6003, #6004 and #6005.' }
  const siblings = [{ number: 6001, state: 'closed' }, { number: 6002, state: 'open' }]
  const stateOf = (n) => ({ 6003: 'closed', 6004: 'open' })[n]
  assert.deepEqual(namedTickets(t, { epic: 1, siblings, stateOf }), [
    { n: 6002, where: 'sibling', state: 'open' },
    { n: 6004, where: 'outside', state: 'open' },
    { n: 6005, where: 'outside', state: 'unknown' },
  ])
  assert.match(hintNotes([t], { epic: 1, siblings, stateOf }), /- #6005 \(outside this epic, state unknown\)/)
})

test('T5: #4433 against the real upload-types.ts finds line 2 citing #3132', () => {
  const rules = codeRules(fx(4433), { root: ROOT })
  const hit = rules.find((r) => r.file === 'packages/crouton-core/server/utils/upload-types.ts' && r.line === 2)
  assert.ok(hit, JSON.stringify(rules))
  assert.deepEqual(hit.refs, [3132])
  assert.match(hintNotes([fx(4433)], { epic: 1, root: ROOT }), /- packages\/crouton-core\/server\/utils\/upload-types\.ts:2 — #3132 — /)
})

test('T6: a missing file and an escaping path throw nothing and list nothing', () => {
  const rules = codeRules(fx(4433), { root: ROOT })
  assert.ok(!rules.some((r) => r.file.startsWith('tests/api/')))
  const t = { number: 1, body: 'See ../etc/passwd.txt, /etc/hostname.x, ../../package.json and nope/missing.ts.' }
  assert.deepEqual(codeRules(t, { root: join(ROOT, 'scripts') }), [])
})

test(`T7: 13 hits are cut to ${CAP} lines plus "… 3 more left out"`, () => {
  const refs = Array.from({ length: 13 }, (_, i) => `#${7000 + i}`).join(' ')
  const out = hintNotes([{ number: 1, body: `Needs ${refs}.` }], { epic: 2, stateOf: allOpen })
  const lines = out.split('\n')
  const start = lines.indexOf('Open tickets it names that are not on its Blocked-by line:')
  const listed = lines.slice(start + 1, lines.indexOf('Rules written in the code it names:'))
  assert.equal(listed.length, CAP + 1)
  assert.equal(listed[CAP - 1], '- #7009 (outside this epic, open)')
  assert.equal(listed[CAP], '- … 3 more left out')
})

test('T8: no hits → "nothing found" under both lists; the CLI exits 0 and falls back to "state unknown" without gh', () => {
  const quiet = hintNotes([{ number: 1, body: 'Nothing to see.' }], { epic: 2, root: ROOT })
  assert.match(quiet, /Blocked-by line:\n- nothing found\nRules written in the code it names:\n- nothing found/)
  assert.match(hintNotes([], {}), /## Automatic hint check[\s\S]*- nothing found/)

  const dir = mkdtempSync(join(tmpdir(), 'ticket-hints-'))
  mkdirSync(join(dir, 'src'))
  writeFileSync(join(dir, 'src', 'rule.ts'), 'export const a = 1 // policy (#8100)\n')
  writeFileSync(join(dir, 'tickets.json'), JSON.stringify([{ number: 11, body: 'Edit `src/rule.ts`; needs #8200 and #12.' }]))
  writeFileSync(join(dir, 'subs.json'), JSON.stringify([{ number: 12, state: 'closed' }]))
  // gh is unreachable (empty PATH) → every outside number is "state unknown", never a crash
  const out = execFileSync(process.execPath, [CLI, 'notes', join(dir, 'tickets.json'), join(dir, 'subs.json'), '--epic', '10', '--root', dir],
    { encoding: 'utf8', env: { PATH: '/nonexistent', GITHUB_REPOSITORY: 'o/r' } })
  assert.match(out, /## Automatic hint check/)
  assert.match(out, /- #8200 \(outside this epic, state unknown\)/)
  assert.doesNotMatch(out, /#12 /)
  assert.match(out, /- src\/rule\.ts:1 — #8100 — /)
  // valid input with no hits → "nothing found" (the check ran)
  writeFileSync(join(dir, 'empty.json'), JSON.stringify([{ number: 13, body: 'Nothing to see.' }]))
  const clean = execFileSync(process.execPath, [CLI, 'notes', join(dir, 'empty.json'), join(dir, 'subs.json'), '--epic', '10', '--root', dir],
    { encoding: 'utf8', env: { PATH: '/nonexistent' } })
  assert.match(clean, /## Automatic hint check[\s\S]*- nothing found/)
  assert.doesNotMatch(clean, /could not run/)
})

test('T10: when the CLI cannot run, the block says "could not run" (never "nothing found") and still exits 0', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ticket-hints-'))
  writeFileSync(join(dir, 'subs.json'), '[]')
  const run = (args) => spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8', env: { PATH: '/nonexistent' } })
  // missing tickets.json
  const missing = run(['notes', join(dir, 'missing.json'), join(dir, 'subs.json'), '--epic', '10'])
  assert.equal(missing.status, 0)
  assert.match(missing.stdout, /## Automatic hint check[\s\S]*could not run — could not read .*missing\.json/)
  assert.doesNotMatch(missing.stdout, /nothing found/)
  assert.match(missing.stderr, /ticket-hints: could not read/)
  // wrong mode
  const wrong = run(['bogus', join(dir, 'subs.json')])
  assert.equal(wrong.status, 0)
  assert.match(wrong.stdout, /## Automatic hint check[\s\S]*could not run — usage: ticket-hints\.mjs notes/)
  assert.doesNotMatch(wrong.stdout, /nothing found/)
  assert.match(wrong.stderr, /usage:/)
})

test('ghStateOf caps lookups, de-duplicates, and maps errors to unknown', () => {
  let calls = 0
  const run = (_cmd, args) => { calls++; if (args[1].endsWith('/3')) throw new Error('boom'); return args[1].endsWith('/1') ? 'open\n' : 'CLOSED' }
  const stateOf = ghStateOf({ repo: 'o/r', max: 3, run })
  assert.equal(stateOf(1), 'open'); assert.equal(stateOf(1), 'open')
  assert.equal(stateOf(2), 'closed'); assert.equal(stateOf(3), undefined)
  assert.equal(stateOf(4), undefined)
  assert.equal(calls, 3)
})

test('T9: ticket-review.yml feeds the hints into the epic file; the reviewer prompt names them', () => {
  const wf = readFileSync(join(ROOT, '.github/workflows/ticket-review.yml'), 'utf8')
  assert.match(wf, /node scripts\/lib\/ticket-hints\.mjs notes "\$D\/tickets\.json" "\$D\/subs\.json" --epic "\$EPIC" --root "\$\{SRC:-\.\}" >> "\$D\/epic\.md"/)
  const prompt = readFileSync(join(ROOT, '.claude/agents/ticket-reviewer.md'), 'utf8')
  assert.match(prompt, /\*Automatic hint check\*/)
  const rule10 = prompt.split('\n').find((l) => l.startsWith('10.'))
  assert.match(rule10, /not on main/)
})
