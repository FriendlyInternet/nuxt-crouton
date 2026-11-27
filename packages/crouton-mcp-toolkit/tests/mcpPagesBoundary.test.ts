/**
 * #3982 / #4097 — the import boundary, checked on the real files.
 *
 * - The pages handler (index + seven tools) lives in server/mcp-pages/; the old
 *   named `handlers/pages/` folder is gone.
 * - No page-key text is left (`/mcp/pages?token`, `scope: 'pages'`, `mcp-pages'`).
 * - Nothing the toolkit loads in EVERY app (server/mcp, utils, api, handlers)
 *   imports crouton-pages / crouton-collab / crouton-layout.
 * - Domain packages do not import crouton-layout (crouton-pages, crouton-collab
 *   and the pages tools may — owner, #3955 Decisions log 2026-11-17).
 * - The three are optional peers; crouton-collab publishes `shared/`; module.ts
 *   reads layers through the public getLayerDirectories(), not `_layers`.
 */
import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'

const pkgDir = resolve(__dirname, '..')
const packagesDir = resolve(pkgDir, '..')
const SKIP = new Set(['node_modules', 'dist', '.nuxt', '.output'])
const SOURCE = /\.(ts|mts|js|mjs|vue)$/

function files(dir: string): string[] {
  if (!existsSync(dir)) return []
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    if (SKIP.has(entry)) continue
    const p = join(dir, entry)
    if (statSync(p).isDirectory()) out.push(...files(p))
    else if (SOURCE.test(entry)) out.push(p)
  }
  return out
}

const importsOf = (file: string, pkgs: string[]) => {
  const src = readFileSync(file, 'utf8')
  return pkgs.filter(p => new RegExp(`(from\\s+|import\\(\\s*|require\\(\\s*)['"]${p.replace('/', '\\/')}(['"/])`).test(src))
}

const THREE = ['@fyit/crouton-pages', '@fyit/crouton-collab', '@fyit/crouton-layout']

describe('pages handler boundary (#3982)', () => {
  // covers: T6
  it('the handler index and the seven tools exist under server/mcp-pages/, handlers/ is gone', () => {
    const dir = join(pkgDir, 'server/mcp-pages')
    for (const f of ['index.ts', 'tools/list-teams.ts', 'tools/list-pages.ts', 'tools/read-page.ts', 'tools/edit-page.ts', 'tools/list-layout-blocks.ts', 'tools/add-layout.ts', 'tools/create-page.ts']) {
      expect(existsSync(join(dir, f)), f).toBe(true)
    }
    expect(existsSync(join(dir, 'handlers'))).toBe(false)
  })

  // covers: T12
  it('no page-key text is left in server/ or velo\'s config', () => {
    const scanned = [...files(join(pkgDir, 'server')), resolve(packagesDir, '../apps/velo/nuxt.config.ts')]
    const stale = /scope: 'pages'|mcp-pages'|mcp\/pages\?token|pages token/
    expect(scanned.filter(f => stale.test(readFileSync(f, 'utf8')))).toEqual([])
  })

  // covers: T12
  it('nothing under server/mcp, server/utils, server/api or server/handlers imports the three packages', () => {
    const scanned = ['server/mcp', 'server/utils', 'server/api', 'server/handlers'].flatMap(d => files(join(pkgDir, d)))
    expect(scanned.length).toBeGreaterThan(5)
    const offenders = scanned.filter(f => importsOf(f, THREE).length > 0)
    expect(offenders).toEqual([])
  })

  // covers: T12
  it('the pages tools do import them (the scan would catch a real import)', () => {
    const lib = files(join(pkgDir, 'server/mcp-pages'))
    expect(lib.flatMap(f => importsOf(f, THREE)).sort()).toEqual(expect.arrayContaining(THREE))
  })

  // covers: T12
  it('no domain package imports @fyit/crouton-layout', () => {
    const domain = ['crouton-bookings', 'crouton-sales', 'crouton-events', 'crouton-calendar', 'crouton-maps', 'crouton-printing']
    const scanned = domain.flatMap(d => files(join(packagesDir, d)))
    expect(scanned.length).toBeGreaterThan(50)
    const offenders = scanned.filter(f => importsOf(f, ['@fyit/crouton-layout']).length > 0)
    expect(offenders).toEqual([])
  })

  // covers: T12
  it('the toolkit lists the three as optional peers', () => {
    const pkg = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8'))
    for (const name of THREE) {
      expect(pkg.peerDependencies?.[name], name).toBeTruthy()
      expect(pkg.peerDependenciesMeta?.[name]?.optional, name).toBe(true)
    }
  })

  // covers: T12
  it('crouton-collab publishes shared/', () => {
    const pkg = JSON.parse(readFileSync(join(packagesDir, 'crouton-collab/package.json'), 'utf8'))
    expect(pkg.files).toContain('shared')
  })

  // covers: T12
  it('module.ts does not read nuxt.options._layers', () => {
    const src = readFileSync(join(pkgDir, 'module.ts'), 'utf8')
    expect(src).not.toContain('_layers')
    expect(src).toContain('getLayerDirectories')
  })
})
