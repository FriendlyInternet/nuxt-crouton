import { describe, it, expect } from 'vitest'
import { tmplDeployConfig } from '../../lib/scaffold-app'

// #1367/#1371 — the scaffold must emit a deploy.config.json whose stagingUrl MATCHES what
// wrangler will actually bind, so nobody hand-guesses a <name>.pmcp.dev alias that has no
// route (the dead-preview bug). URLs are set only when --domain is passed (which is exactly
// when the wrangler custom-domain routes are written).
const vars = (over: Record<string, unknown>) =>
  ({ name: 'snippets', extends: ['@fyit/crouton-core', '@fyit/crouton'], ...over }) as any

describe('tmplDeployConfig', () => {
  it('no --domain → empty stagingUrl (deploy resolves the real *.workers.dev URL), no productionUrl', () => {
    const cfg = JSON.parse(tmplDeployConfig(vars({ domain: undefined })))
    expect(cfg.stagingUrl).toBe('')
    expect(cfg.productionUrl).toBeUndefined()
    expect(cfg.layerPackages).toBe('@fyit/crouton-core @fyit/crouton')
  })

  it('--domain pmcp.dev → staging uses the <name>-staging.<zone> subdomain (NOT the prod pattern)', () => {
    const cfg = JSON.parse(tmplDeployConfig(vars({ domain: 'pmcp.dev' })))
    // The exact bug: the agent wrote snippets.pmcp.dev (prod pattern) for staging.
    expect(cfg.stagingUrl).toBe('https://snippets-staging.pmcp.dev')
    expect(cfg.stagingUrl).not.toBe('https://snippets.pmcp.dev')
    expect(cfg.productionUrl).toBe('https://snippets.pmcp.dev')
  })

  it('stagingUrl always matches the wrangler staging route pattern <name>-staging.<zone>', () => {
    const cfg = JSON.parse(tmplDeployConfig(vars({ name: 'velo', domain: 'friendlyinter.net' })))
    expect(cfg.stagingUrl).toBe('https://velo-staging.friendlyinter.net')
    expect(cfg.productionUrl).toBe('https://velo.friendlyinter.net')
  })
})
