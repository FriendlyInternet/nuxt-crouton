/**
 * #2004 contract — a dispatch command must be ISSUED, not merely MENTIONED.
 *
 * The two fixtures at the bottom are the real comments from the 2026-08-05 incident on
 * #1791: the explanation that accidentally dispatched, and a genuine dispatch. If a
 * future change makes those two behave the same way, this file fails.
 *
 *   node --test scripts/comment-command.test.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseCommand } from './comment-command.mjs'

test('a bare command on its own line dispatches', () => {
  assert.equal(parseCommand('/delegate'), 'delegate')
})

test('prose followed by the command on a line of its own still dispatches', () => {
  // This is how every dispatch in the incident session was written: a steer paragraph,
  // then the command last. It must keep working.
  const body = 'Some context for the worker.\n\nAnother paragraph.\n\n/delegate'
  assert.equal(parseCommand(body), 'delegate')
})

test('delegate-pi wins over delegate — it contains it (#1077)', () => {
  assert.equal(parseCommand('/delegate-pi'), 'delegate-pi')
})

test('deploy maps to delegate, as it always has', () => {
  assert.equal(parseCommand('/deploy'), 'delegate')
})

test('an indented command (list item) still dispatches', () => {
  assert.equal(parseCommand('  /delegate'), 'delegate')
})

// ── the bug: mentions must NOT dispatch ──────────────────────────────────────────────

test('an inline code span does not dispatch', () => {
  assert.equal(parseCommand('Use `/delegate` for a new issue.'), null)
})

test('a table cell does not dispatch — the exact shape of the #1791 misfire', () => {
  const body = [
    '| Situation | Gesture |',
    '|---|---|',
    '| New / unstarted issue | `/delegate` |',
    '| Leaf with a work branch | re-add `work-this` |',
  ].join('\n')
  assert.equal(parseCommand(body), null)
})

test('a fenced code block does not dispatch', () => {
  assert.equal(parseCommand('Example:\n\n```\n/delegate\n```\n'), null)
})

test('a blockquote does not dispatch — quoting someone else is not commanding', () => {
  assert.equal(parseCommand('> /delegate\n\nThat is what fired it.'), null)
})

test('the agent provenance header cannot dispatch', () => {
  // Every agent comment opens with this shape; a command named inside it is discussion.
  const body = '> 🤖 **Claude Code** · interactive agent · _why /delegate misfired_\n\nBody text.'
  assert.equal(parseCommand(body), null)
})

test('mid-sentence mention does not dispatch', () => {
  assert.equal(parseCommand('I re-dispatched with /delegate, which was wrong.'), null)
})

test('a longer command is not read as a shorter one', () => {
  assert.equal(parseCommand('/delegated-work is not a command'), null)
})

test('empty and nullish bodies are safe', () => {
  assert.equal(parseCommand(''), null)
  assert.equal(parseCommand(undefined), null)
  assert.equal(parseCommand(null), null)
})

// ── the two real comments from the incident ──────────────────────────────────────────

test('FIXTURE: the #1791 explanation comment must NOT dispatch', () => {
  const body = [
    "> 🤖 **Claude Code** · interactive agent · _correcting my own mis-routed re-dispatch_",
    '',
    '**The "this run produced nothing" alert was my mistake, not a pipeline fault.**',
    '',
    'Worth writing down as a rule, because the two gestures look interchangeable:',
    '',
    '| Situation | Gesture |',
    '|---|---|',
    '| New / unstarted issue, may need splitting | `/delegate` |',
    '| Leaf with an existing `work-*` branch | remove + re-add **`work-this`** |',
  ].join('\n')
  assert.equal(parseCommand(body), null)
})

test('FIXTURE: the #1979 dispatch comment must dispatch', () => {
  const body = [
    "> 🤖 **Claude Code** · interactive agent · _handing this to the agent pipeline_",
    '',
    'Root cause is already located in the body, so this is a leaf.',
    '',
    "**For the worker:** don't just patch the template string.",
    '',
    '/delegate',
  ].join('\n')
  assert.equal(parseCommand(body), 'delegate')
})
