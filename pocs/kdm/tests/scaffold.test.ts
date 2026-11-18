// #4126 — the scaffold's deploy contract: staging-only address that matches
// deploy.config.json, explicit blob buckets per environment, the guarded
// postinstall, and committed migrations listed in the journal. Reads the real
// committed files the deploy pipeline reads.
import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const ROOT = resolve(__dirname, '..')
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8')

// wrangler.jsonc carries // comments; drop whole-line comments before parsing.
const wrangler = JSON.parse(read('wrangler.jsonc').replace(/^\s*\/\/.*$/gm, ''))
const deployConfig = JSON.parse(read('deploy.config.json'))
const pkg = JSON.parse(read('package.json'))

describe('kdm scaffold deploy contract (#4126)', () => {
  it('has a staging-only custom-domain route that matches deploy.config.json', () => {
    expect(wrangler.routes).toBeUndefined()
    expect(wrangler.env.staging.routes).toEqual([{ pattern: 'kdm.pmcp.dev', custom_domain: true }])
    expect(deployConfig.stagingUrl).toBe('https://kdm.pmcp.dev')
  })

  it('names its own blob bucket and D1 database per environment', () => {
    expect(wrangler.r2_buckets).toEqual([{ binding: 'BLOB', bucket_name: 'kdm-blob' }])
    expect(wrangler.env.staging.r2_buckets).toEqual([{ binding: 'BLOB', bucket_name: 'kdm-staging-blob' }])
    expect(wrangler.d1_databases[0].database_name).toBe('kdm-db')
    expect(wrangler.env.staging.d1_databases[0].database_name).toBe('kdm-staging-db')
  })

  it('uses the guarded postinstall, never a bare nuxt prepare', () => {
    expect(pkg.scripts.postinstall).toBe('nuxt prepare 2>/dev/null || true')
  })

  it('commits every migration its journal lists', () => {
    const dir = 'server/db/migrations/sqlite'
    const journal = JSON.parse(read(`${dir}/meta/_journal.json`))
    expect(journal.entries.length).toBeGreaterThan(0)
    for (const entry of journal.entries) {
      expect(existsSync(join(ROOT, dir, `${entry.tag}.sql`)), entry.tag).toBe(true)
    }
  })
})
