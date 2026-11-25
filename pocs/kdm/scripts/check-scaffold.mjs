#!/usr/bin/env node
// Checks kdm's "settings and CSS only" rule and its hand-fixed settings (#4526, T1).
// Reads files only — no server, no network:
//
//   node pocs/kdm/scripts/check-scaffold.mjs
//
// Prints one line per case; exits 1 on any miss.

import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const app = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const root = resolve(app, '../..')
const read = (p) => { try { return readFileSync(resolve(app, p), 'utf8') } catch { return '' } }
const nuxtConfig = read('nuxt.config.ts')
const json = (p) => { try { return JSON.parse(read(p)) } catch { return {} } }
const deploy = json('deploy.config.json')
const pkg = json('package.json')

const cases = [
  // covers: T1 — no hand-written pages (crouton-pages serves every public address)
  ['no app/pages/', () => !existsSync(resolve(app, 'app/pages'))],
  // covers: T1 — no hand-written layouts (the look is CSS on the package's page)
  ['no app/layouts/', () => !existsSync(resolve(app, 'app/layouts'))],
  // covers: T1 — no hand-written routing
  ['no server/middleware/', () => !existsSync(resolve(app, 'server/middleware'))],
  // covers: T1 — normal team routing, no routingMode override
  ['no routingMode in nuxt.config.ts', () => nuxtConfig !== '' && !/routingMode/.test(nuxtConfig)],
  // covers: T1 — the one team is kdm
  ["defaultTeamSlug: 'kdm'", () => /defaultTeamSlug:\s*'kdm'/.test(nuxtConfig)],
  // covers: T1 — preview seeds and signs in to the same team
  ['deploy.config.json reviewTeam === "kdm"', () => deploy.reviewTeam === 'kdm'],
  // covers: T1 — staging-only POC route
  ['deploy.config.json stagingUrl === "https://kdm.pmcp.dev"', () => deploy.stagingUrl === 'https://kdm.pmcp.dev'],
  // covers: T1 — a POC never ships to production
  ['deploy.config.json has no productionUrl', () => Object.keys(deploy).length > 0 && !('productionUrl' in deploy)],
  // covers: T1 — guarded postinstall (a failing prepare must not break the workspace install)
  ['postinstall is guarded', () => pkg.scripts?.postinstall === 'nuxt prepare 2>/dev/null || true'],
  // covers: T1 — light mode with its own storage key
  ["colorMode storageKey: 'kdm-color-mode'", () => /storageKey:\s*'kdm-color-mode'/.test(nuxtConfig)],
  // covers: T1 — plain addresses, no /en
  ['hideLocaleInUrl: true', () => /hideLocaleInUrl:\s*true/.test(nuxtConfig)],
  // covers: T1 — one language
  ["crouton.config.js locales exactly ['en']", () => {
    const m = read('crouton.config.js').match(/^\s*locales:\s*\[([^\]]*)\]/m)
    return !!m && m[1].split(',').map(s => s.trim().replace(/['"]/g, '')).filter(Boolean).join(',') === 'en'
  }],
  // covers: T1 — the app has its label
  ['.github/labels.yml has poc:kdm', () => {
    try { return /^- name: "poc:kdm"$/m.test(readFileSync(resolve(root, '.github/labels.yml'), 'utf8')) } catch { return false }
  }]
]

let failed = 0
for (const [name, check] of cases) {
  const ok = check()
  if (!ok) failed++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`)
}
console.log(failed ? `\n${failed} of ${cases.length} failed` : `\nall ${cases.length} passed`)
process.exit(failed ? 1 : 0)
