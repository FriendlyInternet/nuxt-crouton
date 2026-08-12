import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as compiler from '@vue/compiler-sfc'
import { isVueFile, vueFilesOnly, sfcErrors, errText } from './verify-touched-compiles.mjs'

test('isVueFile: only .vue paths', () => {
  assert.equal(isVueFile('a/b/Foo.vue'), true)
  assert.equal(isVueFile('a/b/foo.ts'), false)
  assert.equal(isVueFile(''), false)
  assert.equal(isVueFile(undefined), false)
})

test('vueFilesOnly: filters, de-dupes, keeps order', () => {
  assert.deepEqual(
    vueFilesOnly(['x.ts', 'A.vue', 'B.vue', 'A.vue', 'y.json', null]),
    ['A.vue', 'B.vue']
  )
  assert.deepEqual(vueFilesOnly([]), [])
  assert.deepEqual(vueFilesOnly(undefined), [])
})

test('errText: object or string → single trimmed line', () => {
  assert.equal(errText({ message: 'Element is missing end tag.' }), 'Element is missing end tag.')
  assert.equal(errText('boom\n  now'), 'boom now')
  assert.equal(errText(new Error('x\ty')), 'x y')
})

test('sfcErrors: an unbalanced tag (the #2179 case) is caught', () => {
  // The exact shape PR #2180 shipped: a #content wrapper <div> with no closing </div>.
  const broken = `<template>
  <div>
    <UPopover>
      <template #content>
        <div style="z-index: 2147483647; position: relative">
        <div class="w-64 p-1">rows</div>
      </template>
    </UPopover>
  </div>
</template>`
  const errs = sfcErrors(broken, 'FeedbackLauncher.vue', compiler)
  assert.ok(errs.length >= 1, 'expected at least one compile error')
  assert.ok(errs.some(e => /missing end tag/i.test(e)), `expected a missing-end-tag error, got: ${errs.join(' | ')}`)
})

test('sfcErrors: a well-formed SFC compiles clean', () => {
  const ok = `<template>
  <div>
    <UPopover>
      <template #content>
        <div style="z-index: 2147483647; position: relative">
          <div class="w-64 p-1">rows</div>
        </div>
      </template>
    </UPopover>
  </div>
</template>
<script setup lang="ts">
const x = 1
</script>`
  assert.deepEqual(sfcErrors(ok, 'Fine.vue', compiler), [])
})

test('sfcErrors: a malformed template expression is caught', () => {
  const bad = `<template><div :class="{ ">x</div></template>`
  const errs = sfcErrors(bad, 'Bad.vue', compiler)
  assert.ok(errs.length >= 1, `expected a template compile error, got: ${errs.join(' | ')}`)
})
