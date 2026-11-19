/**
 * #3982 T11 — the pages handler is opt-in (`croutonMcpToolkit.pages: true`) and
 * refused without crouton-pages + crouton-collab.
 */
import { describe, it, expect, afterAll } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PAGES_MCP_DIR, layerPackageNames, resolvePagesHandler, resolveToolkitSetup } from '../lib/pages-handler'

const both = ['@fyit/crouton-core', '@fyit/crouton-pages', '@fyit/crouton-collab']

// covers: T11
describe('resolvePagesHandler', () => {
  it('is off when pages is unset or false, even with pages + collab present', () => {
    expect(resolvePagesHandler({ layerPackages: both })).toEqual({ enabled: false })
    expect(resolvePagesHandler({ pages: false, layerPackages: both })).toEqual({ enabled: false })
  })

  it('is on for pages: true with crouton-pages and crouton-collab', () => {
    expect(resolvePagesHandler({ pages: true, layerPackages: both })).toEqual({ enabled: true })
  })

  it('throws naming the missing package when either is absent', () => {
    expect(() => resolvePagesHandler({ pages: true, layerPackages: ['@fyit/crouton-pages'] }))
      .toThrow('croutonMcpToolkit.pages needs @fyit/crouton-pages and @fyit/crouton-collab (missing: @fyit/crouton-collab)')
    expect(() => resolvePagesHandler({ pages: true, layerPackages: ['@fyit/crouton-collab'] }))
      .toThrow('(missing: @fyit/crouton-pages)')
    expect(() => resolvePagesHandler({ pages: true, layerPackages: [] }))
      .toThrow('(missing: @fyit/crouton-pages, @fyit/crouton-collab)')
  })

  it('PAGES_MCP_DIR is the relative "mcp-pages"', () => {
    expect(PAGES_MCP_DIR).toBe('mcp-pages')
  })
})

// covers: T11
describe('resolveToolkitSetup (what module.ts installs)', () => {
  it('is off in production unless enabled, and then never scans layers', () => {
    let scanned = false
    expect(resolveToolkitSetup({ pages: true }, false, () => { scanned = true; return [] }))
      .toEqual({ enabled: false, genericTools: false, pages: false })
    expect(scanned).toBe(false)
  })
  it('defaults to on in dev with generic tools and no pages handler', () => {
    expect(resolveToolkitSetup({}, true, () => both)).toEqual({ enabled: true, genericTools: true, pages: false })
  })
  it('velo\'s config: generic tools off, pages on', () => {
    expect(resolveToolkitSetup({ enabled: true, genericTools: false, pages: true }, false, () => both))
      .toEqual({ enabled: true, genericTools: false, pages: true })
  })
  it('pages: true without collab fails the setup', () => {
    expect(() => resolveToolkitSetup({ enabled: true, pages: true }, false, () => ['@fyit/crouton-pages'])).toThrow('missing: @fyit/crouton-collab')
  })
})

// covers: T11
describe('layerPackageNames', () => {
  const base = mkdtempSync(join(tmpdir(), 'mcp-layers-'))
  afterAll(() => rmSync(base, { recursive: true, force: true }))

  function layer(dir: string, pkg?: unknown) {
    const root = join(base, dir)
    mkdirSync(root, { recursive: true })
    if (pkg !== undefined) writeFileSync(join(root, 'package.json'), typeof pkg === 'string' ? pkg : JSON.stringify(pkg))
    return root
  }

  it('reads each root\'s package name and skips roots without a readable package.json', () => {
    const roots = [
      layer('pages', { name: '@fyit/crouton-pages' }),
      layer('collab/', { name: '@fyit/crouton-collab' }),
      layer('app-without-pkg'),
      layer('broken', '{not json'),
      layer('nameless', { version: '1.0.0' })
    ]
    expect(layerPackageNames(roots)).toEqual(['@fyit/crouton-pages', '@fyit/crouton-collab'])
  })
})
