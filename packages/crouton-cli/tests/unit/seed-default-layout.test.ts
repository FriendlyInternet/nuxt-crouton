import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { collectDefaultLayoutSql } from '../../lib/seed-app'

// #2249 — the generator writes crouton.layout.json for every app, but the table it
// seeds (`layout_configs`) only exists when the app extends @fyit/crouton-layout.
// kassa has the file and not the package, so every staging deploy logged
// "no such table: layout_configs" and skipped the chunk. The layout is now seeded
// only for an app that extends crouton-layout (directly or through another layer).

const core = { buildUpsert: (table: string) => `INSERT INTO "${table}" …;` }
const layout = JSON.stringify({ id: 'default', pattern: 'master-detail', tree: { type: 'pane' } })

let appDir: string

function app(extendsList: string[]) {
  writeFileSync(join(appDir, 'nuxt.config.ts'), `export default defineNuxtConfig({ extends: ${JSON.stringify(extendsList)} })\n`)
  writeFileSync(join(appDir, 'crouton.layout.json'), layout)
}

beforeEach(() => {
  appDir = mkdtempSync(join(tmpdir(), 'seed-layout-'))
})
afterEach(() => rmSync(appDir, { recursive: true, force: true }))

describe('default layout seed (#2249)', () => {
  it('seeds the layout when the app extends crouton-layout', () => {
    app(['@fyit/crouton-core', '@fyit/crouton-layout'])
    expect(collectDefaultLayoutSql(appDir, core, 'team')).toContain('layout_configs')
  })

  it('skips the layout when the app does not extend crouton-layout (kassa)', () => {
    app(['@fyit/crouton-core', '@fyit/crouton-sales'])
    expect(collectDefaultLayoutSql(appDir, core, 'team')).toBe('')
  })

  it('seeds nothing when there is no crouton.layout.json', () => {
    writeFileSync(join(appDir, 'nuxt.config.ts'), 'export default defineNuxtConfig({ extends: [\'@fyit/crouton-layout\'] })\n')
    expect(collectDefaultLayoutSql(appDir, core, 'team')).toBe('')
  })
})
