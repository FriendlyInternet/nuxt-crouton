// T2 (#4105) — every package admin page that used `team-admin` now runs the `can`
// middleware with exactly its own action; every other admin page is pinned as
// unchanged (no `can`), so it opens for the same people as before. A new
// admin page in neither list fails, so the table cannot drift silently.
//
// Reads the real page files: the `definePageMeta({ … })` block is what Nuxt
// compiles into the route record the `can` middleware reads.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { join, relative, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

/** page → the action its `meta.can` must name (Fix step 2 of #4105). */
const GUARDED = {
  'packages/crouton-admin/app/pages/admin/[team]/index.vue': 'admin:access',
  'packages/crouton-admin/app/pages/admin/[team]/team.vue': 'admin:access',
  'packages/crouton-admin/app/pages/admin/[team]/team/index.vue': 'team:manage',
  'packages/crouton-admin/app/pages/admin/[team]/team/settings.vue': 'team:manage',
  'packages/crouton-admin/app/pages/admin/[team]/team/invitations.vue': 'team:manage',
  'packages/crouton-admin/app/pages/admin/[team]/team/roles.vue': 'team:manage',
  'packages/crouton-admin/app/pages/admin/[team]/team/email-logs.vue': 'team:manage',
  'packages/crouton-admin/app/pages/admin/[team]/team/email-templates.vue': 'team:manage',
  'packages/crouton-admin/app/pages/admin/[team]/team/site-info.vue': 'site:manage',
  'packages/crouton-admin/app/pages/admin/[team]/team/look-and-feel.vue': 'site:manage',
  'packages/crouton-admin/app/pages/admin/[team]/team/redirects.vue': 'site:manage',
  'packages/crouton-admin/app/pages/admin/[team]/team/domains.vue': 'team:domains',
  'packages/crouton-assets/app/pages/admin/[team]/media.vue': 'media:manage',
  'packages/crouton-core/app/pages/admin/[team]/crouton/[collection].vue': 'collections:manage',
  'packages/crouton-core/app/pages/admin/[team]/translations/index.vue': 'translations:manage',
  'packages/crouton-events/app/pages/admin/[team]/activity.vue': 'activity:view',
  'packages/crouton-pages/app/pages/admin/[team]/workspace.vue': 'pages:edit'
}

/** Admin pages that never used `team-admin`: they keep `auth` only (no behaviour change). */
const UNCHANGED = [
  'packages/crouton-admin/app/pages/admin/index.vue',
  'packages/crouton-bookings/app/pages/admin/[team]/bookings.vue',
  'packages/crouton-bookings/app/pages/admin/[team]/bookings/email-logs.vue',
  'packages/crouton-bookings/app/pages/admin/[team]/bookings/email-templates.vue',
  'packages/crouton-bookings/app/pages/admin/[team]/bookings/index.vue',
  'packages/crouton-bookings/app/pages/admin/[team]/bookings/locations.vue',
  'packages/crouton-bookings/app/pages/admin/[team]/bookings/settings.vue',
  'packages/crouton-flow/app/pages/admin/[team]/flows.vue',
  'packages/crouton-layout/app/pages/admin/[team]/layout.vue',
  'packages/crouton-sales/app/pages/admin/[team]/sales.vue',
  'packages/crouton-sales/app/pages/admin/[team]/sales/categories.vue',
  'packages/crouton-sales/app/pages/admin/[team]/sales/clients.vue',
  'packages/crouton-sales/app/pages/admin/[team]/sales/devices.vue',
  'packages/crouton-sales/app/pages/admin/[team]/sales/events/[slug]/index.vue',
  'packages/crouton-sales/app/pages/admin/[team]/sales/events/index.vue',
  'packages/crouton-sales/app/pages/admin/[team]/sales/helpers.vue',
  'packages/crouton-sales/app/pages/admin/[team]/sales/index.vue',
  'packages/crouton-sales/app/pages/admin/[team]/sales/locations.vue',
  'packages/crouton-sales/app/pages/admin/[team]/sales/orders.vue',
  'packages/crouton-sales/app/pages/admin/[team]/sales/printers.vue',
  'packages/crouton-sales/app/pages/admin/[team]/sales/products.vue'
]

function walk(dir, out = []) {
  if (!existsSync(dir)) return out
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (p.endsWith('.vue')) out.push(p)
  }
  return out
}

function packagePages() {
  const pkgs = readdirSync(join(ROOT, 'packages')).filter(p => statSync(join(ROOT, 'packages', p)).isDirectory())
  return pkgs.flatMap(p => walk(join(ROOT, 'packages', p, 'app', 'pages')))
    .map(f => relative(ROOT, f).split('\\').join('/'))
}

/** The `definePageMeta({ … })` argument, brace-balanced; '' when there is none. */
export function pageMeta(source) {
  const start = source.indexOf('definePageMeta(')
  if (start < 0) return ''
  const open = source.indexOf('{', start)
  let depth = 0
  for (let i = open; i < source.length; i++) {
    if (source[i] === '{') depth++
    else if (source[i] === '}' && --depth === 0) return source.slice(open, i + 1)
  }
  return ''
}

const read = rel => readFileSync(join(ROOT, rel), 'utf8')
const middlewareOf = meta => meta.match(/middleware:\s*(\[[^\]]*\]|'[^']*'|"[^"]*")/)?.[1] ?? ''
const canOf = meta => meta.match(/\bcan:\s*['"]([^'"]+)['"]/)?.[1] ?? null

test('every guarded page runs the can middleware with exactly its action', () => {
  for (const [page, action] of Object.entries(GUARDED)) {
    const meta = pageMeta(read(page))
    assert.match(middlewareOf(meta), /['"]can['"]/, `${page}: middleware must list 'can'`)
    assert.equal(canOf(meta), action, `${page}: can must be '${action}'`)
  }
})

test('no package page uses the deprecated team-admin middleware', () => {
  const offenders = packagePages().filter(p => /['"]team-admin['"]/.test(read(p)))
  assert.deepEqual(offenders, [])
})

test('admin pages outside the table are unchanged: no can, no can middleware', () => {
  for (const page of UNCHANGED) {
    const meta = pageMeta(read(page))
    assert.equal(canOf(meta), null, `${page}: must not declare can`)
    assert.doesNotMatch(middlewareOf(meta), /['"]can['"]/, `${page}: must not run the can middleware`)
  }
})

test('every package admin page is in exactly one list (the table cannot drift)', () => {
  const known = new Set([...Object.keys(GUARDED), ...UNCHANGED])
  const adminPages = packagePages().filter(p => p.includes('/app/pages/admin/'))
  const unlisted = adminPages.filter(p => !known.has(p))
  assert.deepEqual(unlisted, [], 'a new admin page must be added to GUARDED or UNCHANGED')
  const missing = [...known].filter(p => !adminPages.includes(p))
  assert.deepEqual(missing, [], 'a listed page no longer exists')
  assert.equal(Object.keys(GUARDED).length + UNCHANGED.length, adminPages.length)
})

test('pageMeta reads a nested definePageMeta block', () => {
  const meta = pageMeta(`definePageMeta({ middleware: ['auth', 'can'], can: 'pages:edit', x: { y: 1 } })`)
  assert.equal(canOf(meta), 'pages:edit')
  assert.equal(middlewareOf(meta), `['auth', 'can']`)
  assert.equal(pageMeta('no meta here'), '')
})
