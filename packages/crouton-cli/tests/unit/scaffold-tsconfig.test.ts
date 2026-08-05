import { describe, it, expect } from 'vitest'
import { buildScaffoldFiles, tmplTsconfig } from '../../lib/scaffold-app'

// #1872 — a scaffolded app MUST ship a root tsconfig.json that extends `.nuxt/tsconfig.json`.
// Without it, `nuxt typecheck` runs `vue-tsc` with default options, never sees the auto-import
// type declarations `nuxt prepare` writes into `.nuxt`, and reports every auto-import
// (ref/defineEventHandler/useCrouton/…) as `TS2304: Cannot find name` — thousands of false
// errors on clean generated code. #1866 added the `typecheck` SCRIPT but not this file, so a
// fresh poc could never be verified (the acceptance gate saw the auto-import misses and, rightly,
// treated them as NEUTRAL — so a missing tsconfig would NOT fail the gate; this unit test is the
// regression guard the gate can't be).
const ctx = {
  vars: {
    name: 'probe',
    features: [],
    extends: ['@fyit/crouton-core', '@fyit/crouton-i18n'],
    dialect: 'sqlite',
    cf: false,
    modules: {}
  },
  frameworkPackages: ['@fyit/crouton-core', '@fyit/crouton-i18n'],
  features: [],
  authSecret: 'test-secret'
} as any

describe('scaffold root tsconfig (#1872)', () => {
  it('emits a root tsconfig.json that extends ./.nuxt/tsconfig.json', () => {
    // It's JSONC (a `//` comment, which tsconfig allows) — assert the extends line directly
    // rather than JSON.parse.
    expect(tmplTsconfig()).toContain('"extends": "./.nuxt/tsconfig.json"')
  })

  it('the scaffold file set INCLUDES tsconfig.json (the #1866 omission)', async () => {
    const files = await buildScaffoldFiles(ctx, 'pocs/probe', false)
    const ts = files.find(f => f.path === 'tsconfig.json')
    expect(ts, 'scaffold must emit tsconfig.json').toBeTruthy()
    expect(ts!.content).toContain('"extends": "./.nuxt/tsconfig.json"')
  })
})
