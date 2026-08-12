import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isVueFile, vueFilesOnly, sfcErrors, errText } from './verify-touched-compiles.mjs'

// This suite runs in the dependency-free `scripts-tests` CI job (no `pnpm install`), so it must
// NOT import `@vue/compiler-sfc`. `sfcErrors` takes an INJECTED compiler precisely so its
// composition (parse errors + template errors, throws, no-template) is unit-tested with a mock.
// The REAL compiler catching a real unbalanced tag is covered by the `compile-check` CI job
// (which installs deps and runs scripts/verify-touched-compiles.mjs on the diff) + the manual
// end-to-end in the PR.

/** A configurable stand-in for @vue/compiler-sfc. */
function mockCompiler({ parseErrs = [], parseThrows = false, template = null, tmplErrs = [], tmplThrows = false } = {}) {
  return {
    parse() {
      if (parseThrows) throw new Error('parse boom')
      return {
        descriptor: template != null ? { template: { content: template } } : {},
        errors: parseErrs.map(m => ({ message: m }))
      }
    },
    compileTemplate() {
      if (tmplThrows) throw new Error('compile boom')
      return { errors: tmplErrs.map(m => ({ message: m })) }
    }
  }
}

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

test('sfcErrors: surfaces PARSE errors (the unbalanced-tag / #2179 class)', () => {
  const c = mockCompiler({ parseErrs: ['Element is missing end tag.'] })
  assert.deepEqual(sfcErrors('<template>…</template>', 'Foo.vue', c), ['Element is missing end tag.'])
})

test('sfcErrors: a clean SFC (no template) → no errors', () => {
  assert.deepEqual(sfcErrors('<script>const x=1</script>', 'Fine.vue', mockCompiler()), [])
})

test('sfcErrors: surfaces TEMPLATE compile errors when a <template> is present', () => {
  const c = mockCompiler({ template: '<div :class="{ ">x</div>', tmplErrs: ['Error parsing JavaScript expression'] })
  assert.deepEqual(sfcErrors('<template>…</template>', 'Bad.vue', c), ['Error parsing JavaScript expression'])
})

test('sfcErrors: MERGES parse + template errors', () => {
  const c = mockCompiler({ parseErrs: ['p1'], template: '<div/>', tmplErrs: ['t1', 't2'] })
  assert.deepEqual(sfcErrors('x', 'M.vue', c), ['p1', 't1', 't2'])
})

test('sfcErrors: a thrown parse becomes one error and skips the template compile', () => {
  const errs = sfcErrors('x', 'Throw.vue', mockCompiler({ parseThrows: true }))
  assert.equal(errs.length, 1)
  assert.match(errs[0], /parse boom/)
})

test('sfcErrors: a thrown template compile is caught as an error, not a crash', () => {
  const errs = sfcErrors('x', 'T.vue', mockCompiler({ template: '<div/>', tmplThrows: true }))
  assert.ok(errs.some(e => /compile boom/.test(e)), `expected the caught template throw, got: ${errs.join(' | ')}`)
})
