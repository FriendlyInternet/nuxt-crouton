// gallery-coverage.mjs — every shared package that has UI pieces must be in the gallery (#2462).
//
// The gallery (pocs/gallery) only lists pieces from the layers it pulls in. A new package that
// nobody adds there would just be absent from the gallery and from every PR's review links —
// no build error, no red check. This catches that: a package with components under
// packages/<pkg>/app/components must be reachable from the gallery's @fyit/* dependencies,
// directly or through another package's dependencies (crouton-core brings auth + admin).
//
// Contract + the live repo check: scripts/gallery-coverage.test.mjs (`node --test`, CI scripts-tests).
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Pure. `packages`: [{ name, hasPieces, deps: string[] }]; `galleryDeps`: the gallery's @fyit deps.
 * Returns the names of packages with pieces that the gallery cannot reach, sorted.
 */
export function missingFromGallery({ packages = [], galleryDeps = [] }) {
  const byName = new Map(packages.map(p => [p.name, p]))
  const reached = new Set()
  const queue = [...galleryDeps]
  while (queue.length) {
    const name = queue.shift()
    if (reached.has(name)) continue
    reached.add(name)
    for (const d of byName.get(name)?.deps ?? []) queue.push(d)
  }
  return packages.filter(p => p.hasPieces && !reached.has(p.name)).map(p => p.name).sort()
}

const fyit = obj => Object.keys(obj ?? {}).filter(n => n.startsWith('@fyit/'))

function hasVue(dir) {
  if (!existsSync(dir)) return false
  for (const entry of readdirSync(dir)) {
    if (entry === 'stubs' || entry === 'node_modules') continue
    const p = join(dir, entry)
    if (statSync(p).isDirectory() ? hasVue(p) : entry.endsWith('.vue')) return true
  }
  return false
}

/** Read the real repo into missingFromGallery's input. */
export function readRepo(root = '.') {
  const packages = readdirSync(join(root, 'packages'))
    .filter(d => existsSync(join(root, 'packages', d, 'package.json')))
    .map((d) => {
      const pkg = JSON.parse(readFileSync(join(root, 'packages', d, 'package.json'), 'utf8'))
      return {
        name: pkg.name,
        hasPieces: hasVue(join(root, 'packages', d, 'app', 'components')),
        // dependencies only: a peer dependency means "expects it", not "brings it in".
        deps: fyit(pkg.dependencies),
      }
    })
  const gallery = JSON.parse(readFileSync(join(root, 'pocs', 'gallery', 'package.json'), 'utf8'))
  return { packages, galleryDeps: fyit(gallery.dependencies) }
}
