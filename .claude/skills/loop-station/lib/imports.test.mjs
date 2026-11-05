// The always-on inventory must count what Claude Code actually loads: CLAUDE.md plus
// its `@imports` (#2387). Before this, `@AGENTS.md` (~a third of the always-on load)
// was invisible to the budget.
//   node --test .claude/skills/loop-station/lib/imports.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { resolveImports } from './imports.mjs'

const fs = (files) => ({
  root: '/repo',
  read: (p) => files[p],
  exists: (p) => p in files
})

test('a bare @path line imports the file, relative to the importer', () => {
  const o = fs({ '/repo/CLAUDE.md': '# x\n\n@AGENTS.md\n', '/repo/AGENTS.md': '# agents' })
  assert.deepEqual(resolveImports('/repo/CLAUDE.md', o), ['/repo/CLAUDE.md', '/repo/AGENTS.md'])
})

test('imports resolve recursively, in load order, each file once', () => {
  const o = fs({
    '/repo/CLAUDE.md': '@a.md\n@b.md\n',
    '/repo/a.md': '@shared/c.md\n',
    '/repo/b.md': '@shared/c.md\n',
    '/repo/shared/c.md': 'leaf'
  })
  assert.deepEqual(resolveImports('/repo/CLAUDE.md', o), ['/repo/CLAUDE.md', '/repo/a.md', '/repo/shared/c.md', '/repo/b.md'])
})

test('@~/path resolves from the repo root; ./ and ../ from the importer', () => {
  const o = fs({
    '/repo/docs/CLAUDE.md': '@~/AGENTS.md\n@./local.md\n@../top.md\n',
    '/repo/AGENTS.md': '', '/repo/docs/local.md': '', '/repo/top.md': ''
  })
  assert.deepEqual(resolveImports('/repo/docs/CLAUDE.md', o), ['/repo/docs/CLAUDE.md', '/repo/AGENTS.md', '/repo/docs/local.md', '/repo/top.md'])
})

test('a missing target is skipped, a cycle terminates', () => {
  const o = fs({ '/repo/CLAUDE.md': '@gone.md\n@loop.md\n', '/repo/loop.md': '@CLAUDE.md\n' })
  assert.deepEqual(resolveImports('/repo/CLAUDE.md', o), ['/repo/CLAUDE.md', '/repo/loop.md'])
})

test('inline imports count too; code spans, fenced blocks and emails do not', () => {
  const o = fs({
    '/repo/CLAUDE.md': [
      'mail me@x.dev',
      'see @AGENTS.md for the method.',
      'never `@inline-code.md`',
      '```',
      '@fenced.md',
      '```',
      '@fyit/crouton-core is a package, not a file',
      '  @indented.md  '
    ].join('\n'),
    '/repo/AGENTS.md': '', '/repo/inline-code.md': '', '/repo/fenced.md': '', '/repo/indented.md': ''
  })
  assert.deepEqual(resolveImports('/repo/CLAUDE.md', o), ['/repo/CLAUDE.md', '/repo/AGENTS.md', '/repo/indented.md'])
})
