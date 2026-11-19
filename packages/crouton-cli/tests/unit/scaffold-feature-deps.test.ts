import { describe, expect, it } from 'vitest'
import { scaffoldApp } from '../../lib/scaffold-app.ts'

// #4291 — a feature's manifest `dependencies` (e.g. pages → @fyit/crouton-editor)
// were added as raw strings and then looked up by feature key, so they matched
// nothing and never reached `extends` or package.json. `crouton doctor` then
// failed the fresh app: "extends @fyit/crouton-editor but it is not in dependencies".
const find = (files: Array<{ path: string, content: string }>, p: string) => files.find(f => f.path === p)?.content ?? ''

async function scaffold(opts: { features?: string[], site?: boolean }) {
  const { files } = await scaffoldApp('demo-x', { ...opts, dryRun: true, outDir: '/tmp/crouton-feature-deps' })
  const nuxt = find(files, 'nuxt.config.ts')
  const extendsBlock = nuxt.match(/extends:\s*\[([\s\S]*?)\]/)?.[1] ?? ''
  const extendsList = [...extendsBlock.matchAll(/'([^']+)'/g)].map(m => m[1])
  const deps = Object.keys(JSON.parse(find(files, 'package.json')).dependencies ?? {})
  return { extendsList, deps }
}

describe('scaffoldApp resolves feature dependencies (#4291)', () => {
  // covers: T1 (R1)
  it('features [pages] extends and depends on @fyit/crouton-editor', async () => {
    const { extendsList, deps } = await scaffold({ features: ['pages'] })
    expect(extendsList).toContain('@fyit/crouton-editor')
    expect(deps).toContain('@fyit/crouton-editor')
  })

  // covers: T1 (R2)
  it('--site extends and depends on @fyit/crouton-editor', async () => {
    const { extendsList, deps } = await scaffold({ site: true })
    expect(extendsList).toContain('@fyit/crouton-editor')
    expect(deps).toContain('@fyit/crouton-editor')
  })

  // covers: T1 (R3)
  it('features [bookings] gets @fyit/crouton-catalog', async () => {
    const { extendsList, deps } = await scaffold({ features: ['bookings'] })
    expect(extendsList).toContain('@fyit/crouton-catalog')
    expect(deps).toContain('@fyit/crouton-catalog')
  })

  // covers: T1 (R4) — a bare `crouton-collab` dependency name
  it('features [flow] gets @fyit/crouton-collab', async () => {
    const { extendsList, deps } = await scaffold({ features: ['flow'] })
    expect(extendsList).toContain('@fyit/crouton-collab')
    expect(deps).toContain('@fyit/crouton-collab')
  })

  // covers: T1 (R5) — auth is bundled by core
  it.each([['admin'], ['bookings']])('features [%s] never lists @fyit/crouton-auth', async (feature) => {
    const { extendsList, deps } = await scaffold({ features: [feature] })
    expect(extendsList).not.toContain('@fyit/crouton-auth')
    expect(deps).not.toContain('@fyit/crouton-auth')
  })

  // covers: T1 (R6)
  it('features [] extends only core and i18n', async () => {
    const { extendsList } = await scaffold({ features: [] })
    expect(extendsList).toEqual(['@fyit/crouton-core', '@fyit/crouton-i18n'])
  })
})
