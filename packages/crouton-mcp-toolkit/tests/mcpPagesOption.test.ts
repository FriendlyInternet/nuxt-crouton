/**
 * #3982 / #4097 — the pages handler is opt-in (`croutonMcpToolkit.pages: true`),
 * refused without crouton-pages + crouton-collab, and served at `/mcp` only with
 * crouton-auth's sign-in (`croutonAuth.mcpOAuth`).
 */
import { describe, it, expect, afterAll } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  PAGES_MCP_DIR,
  PAGES_NEED_SIGN_IN_WARNING,
  layerPackageNames,
  resolvePagesHandler,
  resolveToolkitSetup
} from '../lib/pages-handler'

const both = ['@fyit/crouton-core', '@fyit/crouton-pages', '@fyit/crouton-collab']

// covers: T10
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

describe('resolveToolkitSetup (what module.ts installs)', () => {
  // covers: T10
  it('is off in production unless enabled, and then never scans layers', () => {
    let scanned = false
    expect(resolveToolkitSetup({ pages: true }, false, () => { scanned = true; return [] }, true))
      .toEqual({ enabled: false, genericTools: false, pages: false, pagesAtRoot: false, warnings: [] })
    expect(scanned).toBe(false)
  })
  // covers: T10
  it('defaults to on in dev with generic tools and no pages handler', () => {
    expect(resolveToolkitSetup({}, true, () => both))
      .toEqual({ enabled: true, genericTools: true, pages: false, pagesAtRoot: false, warnings: [] })
  })
  // covers: T10
  it('velo\'s config with the sign-in flag off: no page tools, one warning', () => {
    expect(resolveToolkitSetup({ enabled: true, genericTools: false, pages: true }, false, () => both, false))
      .toEqual({ enabled: true, genericTools: false, pages: false, pagesAtRoot: false, warnings: [PAGES_NEED_SIGN_IN_WARNING] })
    expect(PAGES_NEED_SIGN_IN_WARNING).toBe('croutonMcpToolkit.pages: page tools need croutonAuth.mcpOAuth (sign-in); none served')
  })
  // covers: T10
  it('velo\'s config with the sign-in flag on: page tools at /mcp', () => {
    expect(resolveToolkitSetup({ enabled: true, genericTools: false, pages: true }, false, () => both, true))
      .toEqual({ enabled: true, genericTools: false, pages: true, pagesAtRoot: true, warnings: [] })
  })
  // covers: T16
  it('sign-in on but pages off: pagesAtRoot stays false, so the gate keeps /mcp at 404', () => {
    expect(resolveToolkitSetup({ enabled: true, genericTools: false, pages: false }, false, () => both, true))
      .toEqual({ enabled: true, genericTools: false, pages: false, pagesAtRoot: false, warnings: [] })
  })
  // covers: T9
  it('sign-in on with the generic tools on fails the setup with a clear message', () => {
    expect(() => resolveToolkitSetup({ enabled: true, genericTools: true }, false, () => both, true))
      .toThrow('croutonAuth.mcpOAuth cannot be combined with croutonMcpToolkit.genericTools: the generic collection tools still use member tokens — set genericTools: false')
    expect(() => resolveToolkitSetup({ enabled: true }, false, () => both, true)).toThrow('set genericTools: false')
  })
  // covers: T9
  it('sign-in on but the toolkit off: no error (nothing is served)', () => {
    expect(resolveToolkitSetup({ enabled: false, genericTools: true }, false, () => both, true).enabled).toBe(false)
  })
  // covers: T10
  it('pages: true without collab fails the setup', () => {
    expect(() => resolveToolkitSetup({ enabled: true, pages: true }, false, () => ['@fyit/crouton-pages'])).toThrow('missing: @fyit/crouton-collab')
  })
})

// covers: T10
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
