/**
 * #1695 contract — the pipeline-context block that carries { epic, depth, epic_branch }
 * ON an issue so a fresh single-use run (WS1's worker, WS3's decomposer) can read it.
 *
 * The case that minted it: the event-driven redesign (#1685) has no Agent-prompt channel to
 * pass context to a child — the child is picked up by a brand-new workflow run. The block on
 * the body IS that channel; it must parse/write idempotently and stay back-compatible with
 * WS1's bare `pipeline: epic_branch=<name>` line.
 *
 *   node --test scripts/pipeline-context.test.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parsePipelineBlock, formatPipelineBlock, writePipelineBlock } from './pipeline-context.mjs'

const BRANCH = 'epic/1685-single-use-pipeline'

test('parse reads a full wrapped block', () => {
  const body = `Some issue text.\n\n<!-- pipeline: epic=1685 depth=2 epic_branch=${BRANCH} -->`
  assert.deepEqual(parsePipelineBlock(body), { epic: 1685, depth: 2, epic_branch: BRANCH })
})

test('parse tolerates extra whitespace and key order', () => {
  const body = `<!--   pipeline:   epic_branch=${BRANCH}    epic=42   depth=0   -->`
  assert.deepEqual(parsePipelineBlock(body), { epic: 42, depth: 0, epic_branch: BRANCH })
})

test('parse returns nulls for a subset / absent keys', () => {
  assert.deepEqual(parsePipelineBlock('<!-- pipeline: epic_branch=main -->'),
    { epic: null, depth: null, epic_branch: 'main' })
  assert.deepEqual(parsePipelineBlock('no block here'),
    { epic: null, depth: null, epic_branch: null })
  assert.deepEqual(parsePipelineBlock(''), { epic: null, depth: null, epic_branch: null })
  assert.deepEqual(parsePipelineBlock(undefined), { epic: null, depth: null, epic_branch: null })
})

test('parse reads the legacy bare `pipeline:` line WS1 emitted (back-compat)', () => {
  const body = `Implement this leaf.\npipeline: epic_branch=${BRANCH}\nmore text`
  assert.equal(parsePipelineBlock(body).epic_branch, BRANCH)
})

test('parse ignores unknown keys and bad ints', () => {
  assert.deepEqual(parsePipelineBlock('<!-- pipeline: epic=notanint depth=3 wave=2 -->'),
    { epic: null, depth: 3, epic_branch: null })
})

test('depth=0 is preserved, not dropped as falsy', () => {
  assert.equal(parsePipelineBlock('<!-- pipeline: depth=0 -->').depth, 0)
})

test('format emits only present keys in a stable order', () => {
  assert.equal(formatPipelineBlock({ epic: 1685, depth: 2, epic_branch: BRANCH }),
    `<!-- pipeline: epic=1685 depth=2 epic_branch=${BRANCH} -->`)
  assert.equal(formatPipelineBlock({ epic_branch: BRANCH }),
    `<!-- pipeline: epic_branch=${BRANCH} -->`)
  assert.equal(formatPipelineBlock({ depth: 0 }), '<!-- pipeline: depth=0 -->')
  assert.equal(formatPipelineBlock({}), null)
})

test('write appends a block to a body that has none', () => {
  const out = writePipelineBlock('Issue body.', { epic: 1685, depth: 1, epic_branch: BRANCH })
  assert.match(out, /^Issue body\.\n\n<!-- pipeline: epic=1685 depth=1 epic_branch=/)
  assert.deepEqual(parsePipelineBlock(out), { epic: 1685, depth: 1, epic_branch: BRANCH })
})

test('write is idempotent — same context twice is byte-identical', () => {
  const ctx = { epic: 1685, depth: 2, epic_branch: BRANCH }
  const once = writePipelineBlock('Body', ctx)
  const twice = writePipelineBlock(once, ctx)
  assert.equal(twice, once)
})

test('write replaces an existing block in place (no duplication)', () => {
  const start = writePipelineBlock('Body', { epic: 1, depth: 0, epic_branch: 'main' })
  const updated = writePipelineBlock(start, { depth: 1, epic_branch: BRANCH })
  // epic preserved from the merge, depth+branch updated, still exactly one block.
  assert.deepEqual(parsePipelineBlock(updated), { epic: 1, depth: 1, epic_branch: BRANCH })
  assert.equal((updated.match(/<!-- pipeline:/g) || []).length, 1)
})

test('write upgrades a legacy bare line to the wrapped block', () => {
  const legacy = `Do the thing.\npipeline: epic_branch=${BRANCH}`
  const out = writePipelineBlock(legacy, { epic: 1685, depth: 3 })
  assert.match(out, /<!-- pipeline: epic=1685 depth=3 epic_branch=/)
  assert.doesNotMatch(out, /^pipeline:/m) // legacy line is gone
  assert.equal((out.match(/pipeline:/g) || []).length, 1)
})

test('write with empty context leaves a body without a block unchanged', () => {
  assert.equal(writePipelineBlock('Just text.', {}), 'Just text.')
})

test('a partial update with explicit nulls preserves siblings (the CLI write path)', () => {
  // parseTokens yields null for absent keys; `write depth=1` must NOT wipe epic/epic_branch.
  const start = writePipelineBlock('Body', { epic: 1685, depth: 0, epic_branch: BRANCH })
  const updated = writePipelineBlock(start, { epic: null, depth: 1, epic_branch: null })
  assert.deepEqual(parsePipelineBlock(updated), { epic: 1685, depth: 1, epic_branch: BRANCH })
})
