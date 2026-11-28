import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { checkFetchGlobal, resolveEntry } from './check-fetch-global.mjs'

const ENTRY = 'entry.js'
const entrySrc = 'var a=1;globalThis.$fetch||=$f.create({});x();globalThis.$fetch=i.create({onResponseError(){}});'

test('accepts setup before a read in the entry chunk', () => {
  const r = checkFetchGlobal({ files: { [ENTRY]: entrySrc }, entry: ENTRY, expectReaders: 1 })
  assert.equal(r.ok, true, r.errors.join('; '))
  assert.equal(r.sites.length, 1)
  assert.equal(r.sites[0].kind, 'assign')
})

test('accepts a lazy chunk importing #entry', () => {
  const files = {
    [ENTRY]: entrySrc,
    'lazy.js': 'import{a as b}from"#entry";globalThis.$fetch(`/api/upload-image`,{});'
  }
  const r = checkFetchGlobal({ files, entry: ENTRY, expectReaders: 2 })
  assert.equal(r.ok, true, r.errors.join('; '))
  assert.equal(r.sites.find(s => s.chunk === 'lazy.js').why, `imports setup via ${ENTRY}`)
})

test('accepts a transitive ./X.js → #entry import', () => {
  const files = {
    [ENTRY]: entrySrc,
    'mid.js': 'import{a}from"#entry";export const m=1;',
    'leaf.js': 'import"./mid.js";globalThis.$fetch(`/api/upload-image`);'
  }
  const r = checkFetchGlobal({ files, entry: ENTRY, expectReaders: 2 })
  assert.equal(r.ok, true, r.errors.join('; '))
})

test('rejects a read before the setup in the same chunk', () => {
  const files = { [ENTRY]: 'globalThis.$fetch(`/x`);globalThis.$fetch||=$f;' }
  const r = checkFetchGlobal({ files, entry: ENTRY, expectReaders: 1 })
  assert.equal(r.ok, false)
  assert.match(r.errors.join('\n'), /read before setup/)
})

test('rejects a reader with no import path to a setup', () => {
  const files = {
    [ENTRY]: entrySrc,
    'orphan.js': 'import{a}from"./other.js";globalThis.$fetch(`/x`);',
    'other.js': 'export const a=1;'
  }
  const r = checkFetchGlobal({ files, entry: ENTRY, expectReaders: 2 })
  assert.equal(r.ok, false)
  assert.match(r.errors.join('\n'), /orphan\.js: no import path/)
})

test('rejects when no setup exists anywhere', () => {
  const files = { [ENTRY]: 'globalThis.$fetch(`/x`);' }
  const r = checkFetchGlobal({ files, entry: ENTRY, expectReaders: 1 })
  assert.equal(r.ok, false)
  assert.match(r.errors.join('\n'), /no "globalThis\.\$fetch\|\|=" setup/)
})

test('rejects fewer reader sites than expectReaders', () => {
  const r = checkFetchGlobal({ files: { [ENTRY]: entrySrc }, entry: ENTRY, expectReaders: 5 })
  assert.equal(r.ok, false)
  assert.match(r.errors.join('\n'), /found 1 reader site\(s\), expected at least 5/)
})

test('counts sites, not chunks', () => {
  const files = {
    [ENTRY]: entrySrc,
    'two.js': 'import"#entry";globalThis.$fetch(`/a`);globalThis.$fetch(`/b`);'
  }
  const r = checkFetchGlobal({ files, entry: ENTRY, expectReaders: 3 })
  assert.equal(r.ok, true, r.errors.join('; '))
  assert.equal(r.sites.length, 3)
})

function fakeOutput ({ precomputed = true, chunks }) {
  const dir = mkdtempSync(join(tmpdir(), 'cfg-'))
  mkdirSync(join(dir, 'public/_nuxt'), { recursive: true })
  mkdirSync(join(dir, 'server/chunks/virtual'), { recursive: true })
  for (const [f, src] of Object.entries(chunks)) writeFileSync(join(dir, 'public/_nuxt', f), src)
  if (precomputed) writeFileSync(join(dir, 'server/chunks/virtual/precomputed.mjs'), `const m={a:{file:"${ENTRY}",name:"entry",isEntry:true}};`)
  return dir
}

test('resolveEntry reads #entry from precomputed.mjs', () => {
  const dir = fakeOutput({ chunks: { [ENTRY]: entrySrc } })
  assert.equal(resolveEntry(dir), ENTRY)
})

test('CLI passes on a real-shaped .output and fails when #entry is unresolvable', () => {
  const script = new URL('./check-fetch-global.mjs', import.meta.url).pathname
  const chunks = { [ENTRY]: entrySrc, 'up.js': 'import{a}from"#entry";globalThis.$fetch(`/api/upload-image`);' }
  const good = spawnSync(process.execPath, [script, fakeOutput({ chunks }), '--expect', '2'], { encoding: 'utf8' })
  assert.equal(good.status, 0, good.stdout + good.stderr)
  assert.match(good.stdout, /up\.js · call · ok/)
  const bad = spawnSync(process.execPath, [script, fakeOutput({ chunks, precomputed: false }), '--expect', '2'], { encoding: 'utf8' })
  assert.equal(bad.status, 1)
  assert.match(bad.stderr, /could not resolve #entry/)
})
