/**
 * #1845 contract — the recurrence guard for #1839.
 *
 * The rule is narrow on purpose: only an `async` function literal that sits inside
 * the ARRAY form of a transformed `definePageMeta` key is unreachable by unctx's
 * await-restore transform. The single-function form and plain string references
 * are both fine, and must stay unflagged — `middleware: ['auth', 'team-admin']` is
 * the dominant idiom repo-wide.
 *
 *   node --test scripts/check-page-middleware.test.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  findUntransformedAsyncMiddleware,
  scanSfc,
  maskLiteralsAndComments,
  matchBracket
} from './check-page-middleware.mjs'

const sfc = script => `<script setup lang="ts">\n${script}\n</script>\n\n<template><div /></template>\n`

test('flags an async arrow inside the middleware ARRAY form', () => {
  const found = findUntransformedAsyncMiddleware(`
    definePageMeta({
      middleware: [
        async () => {
          const slug = await resolveTeamSlug()
          return navigateTo(\`/admin/\${slug}\`)
        }
      ]
    })
  `)
  assert.equal(found.length, 1)
  assert.equal(found[0].key, 'middleware')
  assert.equal(found[0].protected, false)
})

test('does NOT flag the single-function form — unctx transforms it', () => {
  assert.deepEqual(findUntransformedAsyncMiddleware(`
    definePageMeta({
      middleware: async () => {
        const slug = await resolveTeamSlug()
        return navigateTo(\`/admin/\${slug}\`)
      }
    })
  `), [])
})

test('does NOT flag string references — they resolve to wrapped named middleware', () => {
  assert.deepEqual(
    findUntransformedAsyncMiddleware(`definePageMeta({ middleware: ['auth', 'team-admin'] })`),
    []
  )
})

test('does NOT flag an async callback with no await — nothing to lose context across', () => {
  assert.deepEqual(
    findUntransformedAsyncMiddleware(`definePageMeta({ middleware: [async () => navigateTo('/x')] })`),
    []
  )
})

test('marks a runWithContext callback as protected — that is the sanctioned fix', () => {
  const found = findUntransformedAsyncMiddleware(`
    definePageMeta({
      middleware: [
        async () => {
          const nuxtApp = useNuxtApp()
          const slug = await resolveTeamSlug()
          return nuxtApp.runWithContext(() => navigateTo(\`/admin/\${slug}\`))
        }
      ]
    })
  `)
  assert.equal(found.length, 1)
  assert.equal(found[0].protected, true)
})

test('covers validate as well as middleware', () => {
  const found = findUntransformedAsyncMiddleware(`
    definePageMeta({ validate: [async (route) => { return await check(route) }] })
  `)
  assert.equal(found.length, 1)
  assert.equal(found[0].key, 'validate')
})

test('ignores non-transformed keys entirely', () => {
  assert.deepEqual(
    findUntransformedAsyncMiddleware(`definePageMeta({ other: [async () => { await x() }] })`),
    []
  )
})

test('scanSfc handles TypeScript syntax and points at the real SFC line', () => {
  const source = sfc(`
import type { Team } from '~/types'

definePageMeta({
  layout: false,
  middleware: [
    async (): Promise<unknown> => {
      const team = await useTeam().refresh() as Team
      return navigateTo(\`/admin/\${team.slug}\`)
    }
  ]
})
`)
  const found = scanSfc(source)
  assert.equal(found.length, 1)
  assert.equal(found[0].protected, false)

  // Must point at the offending callback, resolved against the ORIGINAL file —
  // a guard that cites the wrong line costs the reader the time it exists to save.
  const expected = source.split('\n').findIndex(l => l.includes('async ():')) + 1
  assert.equal(found[0].line, expected)
})

test('braces inside strings and comments do not break bracket matching', () => {
  // The masking pass is the whole reason this can be parser-free: a `]` in a
  // string or a commented-out block must not be mistaken for real structure.
  const found = findUntransformedAsyncMiddleware(`
    definePageMeta({
      middleware: [
        // ] } ) a commented-out closing run
        async () => {
          const label = 'a ] and a } inside a string'
          const t = \`template with } and ]\`
          await load(label, t)
          return navigateTo('/x')
        }
      ]
    })
  `)
  assert.equal(found.length, 1)
  assert.equal(found[0].protected, false)
})

test('maskLiteralsAndComments preserves length and newlines', () => {
  const code = `const a = 'xx' // yy\nconst b = 2`
  const masked = maskLiteralsAndComments(code)
  assert.equal(masked.length, code.length)
  assert.equal(masked.split('\n').length, code.split('\n').length)
  assert.ok(!masked.includes('xx'))
  assert.ok(!masked.includes('yy'))
  assert.ok(masked.includes('const b = 2'))
})

test('matchBracket finds the matching close across nesting', () => {
  const code = 'f([1, [2, 3], {a: 4}])'
  const masked = maskLiteralsAndComments(code)
  assert.equal(matchBracket(masked, code.indexOf('[')), code.lastIndexOf(']'))
})

test('a second definePageMeta key on a nested object is not mistaken for the page key', () => {
  assert.deepEqual(findUntransformedAsyncMiddleware(`
    definePageMeta({
      layout: false,
      meta: { nested: { middleware: ['not-a-page-key'] } }
    })
  `), [])
})

test('scanSfc short-circuits on a file without definePageMeta', () => {
  assert.deepEqual(scanSfc(sfc(`const x = await load()`)), [])
})

test('the fixed kassa root page is not flagged', async () => {
  const { readFileSync } = await import('node:fs')
  const source = readFileSync('apps/kassa/app/pages/index.vue', 'utf8')
  assert.deepEqual(scanSfc(source).filter(f => !f.protected), [])
})
