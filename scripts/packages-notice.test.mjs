/**
 * #3701 case 5 — the pi extension `.pi/extensions/packages-notice.ts` tells the worker ONCE per
 * package per run, never blocks, and stays silent on non-package writes, no ticket, or an error.
 * Imports the real .ts (Node 22 strips the types) with a fake `pi`.
 *
 *   node --test scripts/packages-notice.test.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import register, { readTicket } from '../.pi/extensions/packages-notice.ts'

function load(readTicketFn) {
  const handlers = {}
  register({ on: (name, fn) => { (handlers[name] ||= []).push(fn) } }, { readTicket: readTicketFn })
  assert.equal(handlers.tool_result?.length, 1, 'registers one tool_result handler')
  return ev => handlers.tool_result[0]({ content: [{ type: 'text', text: 'ok' }], structuredContent: { x: 1 }, ...ev })
}
const APPROVED = () => ({ ticketBody: 'Packages-approved: owner yes 2026-11-10', ticketLabels: [] })

test('case 5: two writes in the same package → one message, not two', async () => {
  const fire = load(APPROVED)
  const first = await fire({ toolName: 'write', input: { path: 'packages/crouton-core/a.ts' } })
  assert.equal(first.content.length, 2, 'one text block appended to the write result')
  assert.equal(first.content[0].text, 'ok', 'the original result is kept')
  assert.match(first.content[1].text, /Package edit allowed: this ticket approves `crouton-core`/)
  assert.match(first.content[1].text, /Packages-approved: owner yes 2026-11-10/)
  assert.deepEqual(first.structuredContent, { x: 1 })
  const second = await fire({ toolName: 'edit', input: { path: 'packages/crouton-core/b.ts' } })
  assert.equal(second, undefined)
})

test('a write in another package gets its own one message', async () => {
  const fire = load(APPROVED)
  await fire({ toolName: 'write', input: { path: 'packages/crouton-core/a.ts' } })
  const other = await fire({ toolName: 'write', input: { path: `${process.cwd()}/packages/crouton-assets/c.ts` } })
  assert.equal(other.content.length, 2)
  assert.match(other.content[1].text, /crouton-assets/)
  assert.equal(await fire({ toolName: 'write', input: { path: 'packages/crouton-assets/d.ts' } }), undefined)
})

test('non-package writes and non-write tools say nothing', async () => {
  const fire = load(APPROVED)
  assert.equal(await fire({ toolName: 'write', input: { path: 'apps/x.vue' } }), undefined)
  assert.equal(await fire({ toolName: 'read', input: { path: 'packages/crouton-core/a.ts' } }), undefined)
})

test('a pkg:* label-only ticket → allowed, no "undo"', async () => {
  const fire = load(() => ({ ticketBody: 'refactor', ticketLabels: ['pkg:crouton-layout'] }))
  const r = await fire({ toolName: 'write', input: { path: 'packages/crouton-layout/x.vue' } })
  assert.match(r.content[1].text, /allowed/)
  assert.doesNotMatch(r.content[1].text, /undo/)
})

test('an unapproved ticket → the undo-or-say-why message', async () => {
  const fire = load(() => ({ ticketBody: 'docs', ticketLabels: ['app:docs'] }))
  const r = await fire({ toolName: 'write', input: { path: 'packages/crouton-cli/README.md' } })
  assert.match(r.content[1].text, /no package approval for `crouton-cli`: undo the change/)
})

test('readTicket throwing or returning null → undefined, never throws', async () => {
  const boom = load(() => { throw new Error('boom') })
  assert.equal(await boom({ toolName: 'write', input: { path: 'packages/crouton-core/a.ts' } }), undefined)
  const none = load(() => null)
  assert.equal(await none({ toolName: 'write', input: { path: 'packages/crouton-core/a.ts' } }), undefined)
})

test('the default readTicket reads the files the worker workflow writes into RUNNER_TEMP', () => {
  const prev = process.env.RUNNER_TEMP
  const dir = mkdtempSync(join(tmpdir(), 'pkg-notice-'))
  try {
    process.env.RUNNER_TEMP = dir
    assert.equal(readTicket(), null, 'no body file → no ticket')
    writeFileSync(join(dir, 'issue-body.txt'), 'body')
    assert.deepEqual(readTicket(), { ticketBody: 'body', ticketLabels: [] }, 'missing labels file → []')
    writeFileSync(join(dir, 'issue-labels.json'), JSON.stringify(['pkg:crouton-core']))
    assert.deepEqual(readTicket(), { ticketBody: 'body', ticketLabels: ['pkg:crouton-core'] })
  } finally {
    if (prev === undefined) delete process.env.RUNNER_TEMP
    else process.env.RUNNER_TEMP = prev
  }
})
