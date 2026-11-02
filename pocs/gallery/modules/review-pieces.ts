// review-pieces — the gallery's catalogue of every shared UI piece (#2462).
//
// The gallery extends every @fyit/crouton-* layer so any package component can be shown on a
// review link (/__review/<Name>) with no hand-written preview page — the #2423 cost (4.5 h and a
// crashed Worker for one pill). Nuxt's auto-imported components can't be looked up by name at
// runtime unless they're global, and making ~380 components global would put all of them in the
// first page load. So this module writes ONE generated file listing each package component with
// a lazy `import()` — every piece is its own chunk, fetched only when its page opens.
//
// Scope: components whose real file lives in packages/crouton-*/app/components, minus the
// priority -1 stubs (placeholders that real components override) and server/island components.
import { defineNuxtModule, addTemplate } from '@nuxt/kit'
import type { Component } from '@nuxt/schema'
import { realpathSync } from 'node:fs'
import { DEMO_TEAM_SLUG } from '../demo-team'

const PACKAGE_RE = /\/packages\/(crouton-[^/]+)\/app\/components\//

interface ReviewPiece {
  name: string
  pkg: string
  file: string
  /** Repo-relative path (packages/…) — how a PR names a changed piece (`/__review?file=`). */
  src: string
}

interface ReviewScreen {
  pkg: string
  label: string
  /** Link target with the demo team filled in. */
  to: string
}

const PAGE_RE = /\/packages\/(crouton-[^/]+)\/app\/pages\//

type Candidate = Pick<Component, 'pascalName' | 'filePath' | 'priority' | 'mode' | 'island'>

function realPath(file: string): string {
  try { return realpathSync(file).replace(/\\/g, '/') } catch { return file } // virtual or missing
}

/** The package a component belongs to, or null when it isn't a reviewable piece. */
function packageOf(c: Candidate, real: string): string | null {
  const pkg = PACKAGE_RE.exec(real)?.[1]
  if (!pkg) return null
  const isStub = (c.priority ?? 0) < 0 || real.includes('/stubs/')
  const isServer = c.mode === 'server' || !!c.island
  return isStub || isServer ? null : pkg
}

/** Which components are reviewable pieces, as plain data. */
function selectPieces(components: Candidate[]): ReviewPiece[] {
  const seen = new Map<string, ReviewPiece & { priority: number }>()
  for (const c of components) {
    const file = realPath(c.filePath)
    const pkg = packageOf(c, file)
    if (!pkg) continue
    const priority = c.priority ?? 0
    // Same name from two layers: keep the higher priority (the one the app would actually render).
    const prev = seen.get(c.pascalName)
    if (!prev || priority > prev.priority) seen.set(c.pascalName, { name: c.pascalName, pkg, file, src: file.slice(file.indexOf('/packages/') + 1), priority })
  }
  return [...seen.values()]
    .map(({ priority: _p, ...p }) => p)
    .sort((a, b) => a.pkg.localeCompare(b.pkg) || a.name.localeCompare(b.name))
}

/** Pages that belong to shared email infrastructure, not to the package that happens to ship them. */
const SHARED_LEAVES = new Set(['email-logs', 'email-templates'])
/** Keep the row scannable on a phone: shallowest screens first, at most this many per package. */
const MAX_SCREENS_PER_PKG = 6

/** One route as a screen link, or null when it needs more than the team or is shared infrastructure. */
function toScreen(r: { path: string, file?: string }): ReviewScreen | null {
  const pkg = r.file ? PAGE_RE.exec(realPath(r.file))?.[1] : undefined
  if (!pkg || !r.path.includes(':team')) return null
  const to = r.path.replace(/:team(\([^)]*\))?/, DEMO_TEAM_SLUG)
  if (to.includes(':')) return null
  const segments = to.split('/').filter(Boolean)
  const rest = segments.slice(segments.indexOf(DEMO_TEAM_SLUG) + 1)
  if (rest.length && SHARED_LEAVES.has(rest[rest.length - 1]!)) return null
  // A package's own section (`bookings` in crouton-bookings) is its home: its root is the overview.
  const shown = rest[0] === pkg.replace(/^crouton-/, '') ? rest.slice(1) : rest
  return { pkg, label: shown.join('/') || 'overview', to }
}

/**
 * A package's own pages as links: only routes that need nothing but the team (no `:id`), labelled
 * by the full path after the team slug (`bookings/locations`; the team home is `overview`),
 * de-duplicated by target.
 */
export function selectScreens(routes: { path: string, file?: string }[]): ReviewScreen[] {
  const byPkg = new Map<string, Map<string, ReviewScreen>>()
  for (const screen of routes.map(toScreen)) {
    if (!screen) continue
    const list = byPkg.get(screen.pkg) ?? new Map<string, ReviewScreen>()
    if (!list.has(screen.to)) list.set(screen.to, screen)
    byPkg.set(screen.pkg, list)
  }
  return [...byPkg.values()].flatMap(list =>
    [...list.values()]
      .sort((x, y) => x.label.split('/').length - y.label.split('/').length)
      .slice(0, MAX_SCREENS_PER_PKG),
  )
}

export default defineNuxtModule({
  meta: { name: 'gallery-review-pieces' },
  setup(_options, nuxt) {
    let pieces: ReviewPiece[] = []
    let screens: ReviewScreen[] = []
    nuxt.hook('pages:extend', (pages) => {
      const flat: { path: string, file?: string }[] = []
      const walk = (list: typeof pages, base: string) => {
        for (const p of list) {
          const path = p.path.startsWith('/') ? p.path : `${base}/${p.path}`
          flat.push({ path: path.replace(/\/+$/, '') || '/', file: p.file })
          if (p.children) walk(p.children, path)
        }
      }
      walk(pages, '')
      screens = selectScreens(flat)
    })
    nuxt.hook('components:extend', (components) => {
      pieces = selectPieces(components)
    })
    addTemplate({
      filename: 'gallery-pieces.mjs',
      write: true,
      getContents: () => [
        '// generated by pocs/gallery/modules/review-pieces.ts — do not edit',
        'export const pieces = [',
        ...pieces.map(p => `  { name: ${JSON.stringify(p.name)}, pkg: ${JSON.stringify(p.pkg)}, src: ${JSON.stringify(p.src)}, load: () => import(${JSON.stringify(p.file)}) },`),
        ']',
      ].join('\n'),
    })
    addTemplate({
      filename: 'gallery-screens.mjs',
      write: true,
      getContents: () => `// generated by pocs/gallery/modules/review-pieces.ts — do not edit\nexport const screens = ${JSON.stringify(screens, null, 2)}\n`,
    })
    addTemplate({
      filename: 'gallery-screens.d.ts',
      write: true,
      getContents: () => 'export declare const screens: { pkg: string, label: string, to: string }[]\n',
    })
    addTemplate({
      filename: 'gallery-pieces.d.ts',
      write: true,
      getContents: () => 'import type { Component } from "vue"\nexport declare const pieces: { name: string, pkg: string, src: string, load: () => Promise<{ default: Component }> }[]\n',
    })
  },
})
