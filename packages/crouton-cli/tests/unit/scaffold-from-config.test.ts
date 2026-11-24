import { describe, it, expect, afterAll } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { scaffoldApp } from '../../lib/scaffold-app'

// #4377 — scaffolding into a dir that already holds a reviewed crouton.config.js reads its
// schemas: image/file fields pull in @fyit/crouton-assets (+ hub.blob + R2), and a `seed`
// collection pulls in drizzle-seed. A config without those gets none of it.
const dirs: string[] = []
afterAll(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }) })

function makeConfigDir(fields: Record<string, unknown>, seed: boolean): string {
  const dir = mkdtempSync(join(tmpdir(), 'crouton-4377-'))
  dirs.push(dir)
  mkdirSync(join(dir, 'schemas'))
  writeFileSync(join(dir, 'schemas', 'posts.json'), JSON.stringify(fields))
  writeFileSync(join(dir, 'crouton.config.js'), `export default {
  collections: [{ name: 'posts', fieldsFile: './schemas/posts.json'${seed ? ', seed: true' : ''} }],
  targets: [{ layer: 'site', collections: ['posts'] }]
}
`)
  return dir
}

const parseJsonc = (text: string) => JSON.parse(text.split('\n').filter(l => !/^\s*\/\//.test(l)).join('\n'))
const file = (files: Array<{ path: string, content: string }>, p: string) => files.find(f => f.path === p)!.content

describe('scaffoldApp from a preserved config (#4377)', () => {
  it('T2a. image/file fields + seed → assets extended/installed, hub.blob, r2_buckets, drizzle-seed', async () => {
    const dir = makeConfigDir({
      title: { type: 'string' },
      cover: { type: 'image' },
      attachment: { type: 'file' }
    }, true)
    const { files } = await scaffoldApp('demo', { outDir: dir, dryRun: true, cf: true })
    const nuxt = file(files, 'nuxt.config.ts')
    expect(nuxt).toContain(`'@fyit/crouton-assets'`)
    expect(nuxt).toMatch(/hub: \{[^}]*blob: true/)
    const pkg = JSON.parse(file(files, 'package.json'))
    expect(pkg.dependencies['@fyit/crouton-assets']).toBe('workspace:*')
    expect(pkg.devDependencies['drizzle-seed']).toBe('^0.3.1')
    const w = parseJsonc(file(files, 'wrangler.jsonc'))
    expect(w.r2_buckets).toEqual([{ binding: 'BLOB', bucket_name: 'demo-blob' }])
  })

  it('T2b. no image/file fields, no seed → no assets, no blob, no drizzle-seed', async () => {
    const dir = makeConfigDir({ title: { type: 'string' }, body: { type: 'text' } }, false)
    const { files } = await scaffoldApp('demo', { outDir: dir, dryRun: true, cf: true })
    const nuxt = file(files, 'nuxt.config.ts')
    expect(nuxt).not.toContain('crouton-assets')
    expect(nuxt).not.toContain('blob: true')
    const pkg = JSON.parse(file(files, 'package.json'))
    expect(pkg.dependencies['@fyit/crouton-assets']).toBeUndefined()
    expect(pkg.devDependencies['drizzle-seed']).toBeUndefined()
    expect(file(files, 'wrangler.jsonc')).not.toContain('r2_buckets')
  })

  it('T2c. array-format schema ({ fields: [...] }) is read too', async () => {
    const dir = makeConfigDir({ name: 'posts', fields: [{ name: 'title', type: 'string' }, { name: 'cover', type: 'image' }] }, false)
    const { files } = await scaffoldApp('demo', { outDir: dir, dryRun: true, cf: true })
    expect(file(files, 'nuxt.config.ts')).toContain(`'@fyit/crouton-assets'`)
  })
})
