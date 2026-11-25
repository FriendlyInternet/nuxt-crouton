// node --test scripts/lib/route-rules-shadow.test.mjs
// #4300: a `*` cache rule on a prefix that also has `[id]` handlers makes Nuxt
// register its renderer there, and radix3 then sends deeper routes to
// "Page Not Found". This guard runs over every real nuxt.config.ts.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { findShadowingRules, repoTargets } from './route-rules-shadow.mjs'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const targets = repoTargets(repoRoot)
const velo = targets.find(t => relative(repoRoot, t.config) === join('apps', 'velo', 'nuxt.config.ts'))

// covers: T1
test('#4300 flags velo\'s old bookings swr rules (detector is not a no-op)', () => {
  assert.ok(velo, 'apps/velo/nuxt.config.ts must be a target')
  const configText = `
  routeRules: {
    '/api/crouton-bookings/teams/*/availability': { swr: 300 },
    '/api/crouton-bookings/teams/*/locations': { swr: 600 },
  }`
  const hits = findShadowingRules({ configText, serverRoots: velo.serverRoots })
  assert.deepEqual(hits.map(h => h.rule), [
    '/api/crouton-bookings/teams/*/availability',
    '/api/crouton-bookings/teams/*/locations',
  ])
  const expected = join('packages', 'crouton-bookings', 'server', 'api', 'crouton-bookings', 'teams', '[id]')
  for (const hit of hits) {
    assert.ok(hit.paramDirs.map(d => relative(repoRoot, d)).includes(expected), `${hit.rule} → ${hit.paramDirs.join(', ')}`)
  }
})

// covers: T1
test('#4300 ignores commented-out and headers-only rules', () => {
  const configText = `
  routeRules: {
    // '/api/teams/*/pages/**': { isr: 3600 },
    '/api/public/**': { headers: { 'cache-control': 'no-store' } },
    '/api/teams/*/thing': { headers: { 'cache-control': 'no-store' } },
  }`
  assert.deepEqual(findShadowingRules({ configText, serverRoots: velo.serverRoots }), [])
})

// covers: T1
test('#4300 no real nuxt.config.ts has a shadowing cache rule', () => {
  assert.ok(targets.length >= 30, `expected ≥30 nuxt configs, found ${targets.length}`)
  const problems = []
  for (const { config, serverRoots } of targets) {
    const hits = findShadowingRules({ configText: readFileSync(config, 'utf8'), serverRoots })
    for (const { rule, paramDirs } of hits) {
      problems.push(`${relative(repoRoot, config)} ${rule} -> ${paramDirs.map(d => relative(repoRoot, d)).join(', ')}`)
    }
  }
  assert.deepEqual(problems, [], `routeRules that shadow [param] handlers (cache in the handler instead):\n${problems.join('\n')}`)
})
