/**
 * build-review author match (#2992): the CLI reports `app/nuxt-harness`, REST `nuxt-harness[bot]`.
 *
 *   node --test scripts/is-pipeline-author.test.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isPipelineAuthor } from './is-pipeline-author.mjs'

test('accepts every spelling of the pipeline bot', () => {
  for (const l of ['nuxt-harness[bot]', 'claude[bot]', 'app/nuxt-harness', 'nuxt-harness', 'claude']) {
    assert.equal(isPipelineAuthor(l), true, l)
  }
})

test('rejects humans and look-alikes', () => {
  for (const l of ['pmcp', 'nuxt-harness-evil', 'xclaude', 'app/pmcp', 'nuxt-harness[bot]x', '', null, undefined]) {
    assert.equal(isPipelineAuthor(l), false, String(l))
  }
})
