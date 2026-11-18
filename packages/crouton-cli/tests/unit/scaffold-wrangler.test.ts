import { describe, it, expect } from 'vitest'
import { tmplWranglerJsonc, tmplDeployConfig, scaffoldApp } from '../../lib/scaffold-app'

// #4142 — `crouton init` must write the R2 buckets an `assets` app needs, and a POC's
// staging route + stagingUrl must be the `<name>.<zone>` form the POC deploy tooling uses.
const vars = (over: Record<string, unknown>) =>
  ({ name: 'demo', features: [], extends: ['@fyit/crouton-core'], poc: false, blob: false, ...over }) as any

// Parse JSONC by dropping full-line `//` comments (the template only uses those).
const parse = (text: string) =>
  JSON.parse(text.split('\n').filter(l => !/^\s*\/\//.test(l)).join('\n'))

describe('tmplWranglerJsonc (#4142)', () => {
  it('1. assets on → r2_buckets <name>-blob at top level and <name>-staging-blob under env.staging', () => {
    const w = parse(tmplWranglerJsonc(vars({ blob: true })))
    expect(w.r2_buckets).toEqual([{ binding: 'BLOB', bucket_name: 'demo-blob' }])
    expect(w.env.staging.r2_buckets).toEqual([{ binding: 'BLOB', bucket_name: 'demo-staging-blob' }])
    // D1/KV are still there
    expect(w.d1_databases[0].database_name).toBe('demo-db')
    expect(w.env.staging.kv_namespaces).toEqual([{ binding: 'KV' }])
  })

  it('1b. real scaffold: --features assets in pocs/ turns the bucket on (resolved features)', async () => {
    const { files } = await scaffoldApp('demo', { features: ['assets'], domain: 'pmcp.dev', outDir: 'pocs/demo', dryRun: true, cf: true })
    const wrangler = files.find(f => f.path === 'wrangler.jsonc')!
    const w = parse(wrangler.content)
    expect(w.r2_buckets[0].bucket_name).toBe('demo-blob')
    expect(w.env.staging.r2_buckets[0].bucket_name).toBe('demo-staging-blob')
    expect(w.routes).toBeUndefined()
    expect(w.env.staging.routes).toEqual([{ pattern: 'demo.pmcp.dev', custom_domain: true }])
    const cfg = JSON.parse(files.find(f => f.path === 'deploy.config.json')!.content)
    expect(cfg.stagingUrl).toBe('https://demo.pmcp.dev')
    expect(cfg.productionUrl).toBeUndefined()
  })

  it('2. assets off → no r2_buckets (output identical to the pre-#4142 template)', () => {
    const text = tmplWranglerJsonc(vars({ blob: false }))
    expect(text).not.toContain('r2_buckets')
    const w = parse(text)
    expect(w.r2_buckets).toBeUndefined()
    expect(w.env.staging.r2_buckets).toBeUndefined()
    // byte-shape of today's KV block (no trailing bucket)
    expect(text).toContain('  "kv_namespaces": [\n    { "binding": "KV" }\n  ],\n')
    expect(text).toContain('      "kv_namespaces": [\n        { "binding": "KV" }\n      ]\n    }')
  })

  it('3. --poc --domain pmcp.dev → staging route <name>.pmcp.dev, no top-level route, stagingUrl matches, no productionUrl', () => {
    const w = parse(tmplWranglerJsonc(vars({ poc: true, domain: 'pmcp.dev' })))
    expect(w.routes).toBeUndefined()
    expect(w.env.staging.routes).toEqual([{ pattern: 'demo.pmcp.dev', custom_domain: true }])
    const cfg = JSON.parse(tmplDeployConfig(vars({ poc: true, domain: 'pmcp.dev' })))
    expect(cfg.stagingUrl).toBe('https://demo.pmcp.dev')
    expect(cfg.productionUrl).toBeUndefined()
  })

  it('4. --domain without --poc → unchanged (<name>-staging. + <name>.)', () => {
    const w = parse(tmplWranglerJsonc(vars({ domain: 'pmcp.dev' })))
    expect(w.routes).toEqual([{ pattern: 'demo.pmcp.dev', custom_domain: true }])
    expect(w.env.staging.routes).toEqual([{ pattern: 'demo-staging.pmcp.dev', custom_domain: true }])
    const cfg = JSON.parse(tmplDeployConfig(vars({ domain: 'pmcp.dev' })))
    expect(cfg.stagingUrl).toBe('https://demo-staging.pmcp.dev')
    expect(cfg.productionUrl).toBe('https://demo.pmcp.dev')
  })

  it('5. no --domain → no routes, empty stagingUrl (POC or not)', () => {
    for (const poc of [false, true]) {
      const w = parse(tmplWranglerJsonc(vars({ poc })))
      expect(w.routes).toBeUndefined()
      expect(w.env.staging.routes).toBeUndefined()
      const cfg = JSON.parse(tmplDeployConfig(vars({ poc })))
      expect(cfg.stagingUrl).toBe('')
      expect(cfg.productionUrl).toBeUndefined()
    }
  })
})
