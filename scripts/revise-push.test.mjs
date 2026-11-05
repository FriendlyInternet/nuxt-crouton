import { test } from 'node:test'
import assert from 'node:assert/strict'
import { pushFailure, behindVerdict, checkUpToDate } from './revise-push.mjs'

const MERGED = '01355c7b9aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
const fake = (seq) => {
  const calls = []
  const compare = async (t) => { calls.push(t); return seq[Math.min(calls.length - 1, seq.length - 1)] }
  return { calls, compare }
}
const noSleep = async () => {}

test('1 merge pushed, main moved later → passes, compares the SHA never the name', async () => {
  const { calls, compare } = fake([{ behind_by: 0, ahead_by: 1 }])
  const r = await checkUpToDate({ target: MERGED, base: 'main', branch: 'work-3073', compare, sleep: noSleep })
  assert.equal(r.ok, true)
  assert.ok(calls.includes(MERGED))
  assert.ok(!calls.includes('main'))
})

test('2 merge never reached GitHub → fails with numbers', async () => {
  const { compare } = fake([{ behind_by: 406, ahead_by: 1 }])
  const r = await checkUpToDate({ target: MERGED, base: 'main', branch: 'work-3073', compare, sleep: noSleep })
  assert.equal(r.ok, false)
  for (const s of ['406', '1 ahead', 'main', '01355c7', 'work-3073']) assert.match(r.message, new RegExp(s))
})

test('3 GitHub slow to show the push → ok after 2 calls', async () => {
  const { calls, compare } = fake([{ behind_by: 1 }, { behind_by: 0 }])
  const r = await checkUpToDate({ target: MERGED, base: 'main', branch: 'b', compare, sleep: noSleep })
  assert.equal(r.ok, true)
  assert.equal(calls.length, 2)
})

test('4 still behind after the second read → fails after 2 calls', async () => {
  const { calls, compare } = fake([{ behind_by: 2 }, { behind_by: 2 }])
  const r = await checkUpToDate({ target: MERGED, base: 'main', branch: 'b', compare, sleep: noSleep })
  assert.equal(r.ok, false)
  assert.equal(calls.length, 2)
})

test('5 behind 0 is ok', () => {
  assert.equal(behindVerdict({ behindBy: 0, target: MERGED, base: 'main', branch: 'b' }).ok, true)
})

test('6 unreadable compare → not ok, says so', () => {
  const r = behindVerdict({ behindBy: undefined, target: MERGED, base: 'main', branch: 'b' })
  assert.equal(r.ok, false)
  assert.match(r.message, /could not read the compare result/)
})

test('7 head unchanged + Internal Server Error → refused', () => {
  const out = ' ! [remote rejected]     HEAD -> work-3073 (Internal Server Error)\nerror: failed to push some refs'
  const r = pushFailure({ output: out, remoteHead: 'abc', expectedHead: 'abc' })
  assert.equal(r.kind, 'refused')
  assert.match(r.line, /Internal Server Error/)
})

test('8 head unchanged + commit_refs_rules (two lines) → refused', () => {
  const out = ' ! [remote rejected] HEAD -> work-3073 (fatal error in commit_refs_rules\n)\nerror: failed to push'
  const r = pushFailure({ output: out, remoteHead: 'abc', expectedHead: 'abc' })
  assert.equal(r.kind, 'refused')
  assert.equal(r.line, '! [remote rejected] HEAD -> work-3073 (fatal error in commit_refs_rules)')
})

test('9 remote head differs → moved', () => {
  assert.equal(pushFailure({ output: '', remoteHead: 'def', expectedHead: 'abc' }).kind, 'moved')
})

test('10 no remote head + stale info → moved', () => {
  const out = ' ! [rejected]        HEAD -> work-3073 (stale info)'
  assert.equal(pushFailure({ output: out, remoteHead: '', expectedHead: 'abc' }).kind, 'moved')
})

test('11 no remote head + permission denied → unknown, carries the error', () => {
  const out = 'remote: Permission to x denied\nfatal: unable to access'
  const r = pushFailure({ output: out, remoteHead: '', expectedHead: 'abc' })
  assert.equal(r.kind, 'unknown')
  assert.match(r.line, /unable to access/)
})
