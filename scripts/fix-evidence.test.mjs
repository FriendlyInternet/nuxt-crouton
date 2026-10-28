// layer: harness
// Contract for the pipeline-fix evidence check (#2657). Run: node --test scripts/fix-evidence.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { evidenceNeeded, findEvidence, mergedAt } from './fix-evidence.mjs'

test('evidenceNeeded reads the line, trims, strips backticks, null when absent', () => {
  assert.equal(evidenceNeeded('intro\nEvidence-needed: pi mcp: not blocked  \nmore'), 'pi mcp: not blocked')
  assert.equal(evidenceNeeded('Evidence-needed: `pi tools: ok`'), 'pi tools: ok')
  assert.equal(evidenceNeeded('no such line'), null)
  assert.equal(evidenceNeeded('Evidence-needed:   '), null)
  assert.equal(evidenceNeeded(null), null)
})

test('findEvidence matches title + ": " + message case-insensitively', () => {
  const anns = [{ title: 'pi tools', message: 'x' }, { title: 'pi mcp', message: 'Not Blocked' }]
  assert.equal(findEvidence('pi mcp: not blocked', anns), anns[1])
  assert.equal(findEvidence('absent', anns), null)
  assert.equal(findEvidence('', anns), null)
  assert.equal(findEvidence('x', []), null)
})

test('mergedAt takes the merged PR from cross-references, null when none merged', () => {
  const ev = m => ({ event: 'cross-referenced', source: { issue: { pull_request: { merged_at: m } } } })
  assert.equal(mergedAt([ev(null), ev('2026-10-26T10:00:00Z')]), '2026-10-26T10:00:00Z')
  assert.equal(mergedAt([ev(null), { event: 'labeled' }]), null)
})
