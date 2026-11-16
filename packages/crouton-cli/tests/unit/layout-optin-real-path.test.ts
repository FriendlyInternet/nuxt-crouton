import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { resolveExtendedPackages } from '../../lib/utils/extended-packages.ts'
import { writeDefaultLayout } from '../../lib/compose-layout.ts'

// #2282 — the same call chain composeDefaultLayoutStep runs in production:
// the app's real nuxt.config `extends` → resolveExtendedPackages → writeDefaultLayout.

const collections = [{ name: 'posts', layer: 'blog', fields: [] }] as any
let appDir: string

function app(extendsList: string[]) {
  writeFileSync(join(appDir, 'nuxt.config.ts'), `export default defineNuxtConfig({ extends: ${JSON.stringify(extendsList)} })\n`)
}

beforeEach(() => { appDir = mkdtempSync(join(tmpdir(), 'layout-optin-')) })
afterEach(() => rmSync(appDir, { recursive: true, force: true }))

describe('default layout opt-in via the app\'s real nuxt.config (#2282)', () => {
  it('writes crouton.layout.json for an app that extends crouton-layout', async () => {
    app(['@fyit/crouton-core', '@fyit/crouton-layout'])
    const r = await writeDefaultLayout({ allCollections: collections, packages: resolveExtendedPackages(appDir), cwd: appDir })
    expect(r.written).toBe(true)
    expect(existsSync(join(appDir, 'crouton.layout.json'))).toBe(true)
  })

  it('skips with "layout not enabled" (the line the CLI logs) for an app that does not', async () => {
    app(['@fyit/crouton-core'])
    const r = await writeDefaultLayout({ allCollections: collections, packages: resolveExtendedPackages(appDir), cwd: appDir })
    expect(r.written).toBe(false)
    expect(r.reason).toBe('layout not enabled')
    expect(existsSync(join(appDir, 'crouton.layout.json'))).toBe(false)
  })
})
