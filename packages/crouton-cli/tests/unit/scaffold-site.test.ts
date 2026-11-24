import { describe, expect, it } from 'vitest'
import { scaffoldApp } from '../../lib/scaffold-app.ts'

// #4263 — `crouton init --site`: a small public site in one command. It copies
// kdm's working settings (one team `test1`, one locale `en` with plain
// addresses, an empty appDomains list) and adds crouton-pages — and writes no
// pages, middleware or routingMode of its own.
const find = (files: Array<{ path: string, content: string }>, p: string) => files.find(f => f.path === p)?.content ?? ''

describe('scaffoldApp --site (#4263)', () => {
  // covers: T1
  it('writes one team, plain one-language addresses and extends crouton-pages', async () => {
    const { files } = await scaffoldApp('demo-site', { site: true, dryRun: true, outDir: '/tmp/crouton-site' })
    const nuxt = find(files, 'nuxt.config.ts')

    // C1 — one team, the review login's team, nothing to switch/create/manage.
    expect(nuxt).toContain('defaultTeamSlug: \'test1\'')
    expect(nuxt).toContain('allowCreate: false')
    expect(nuxt).toContain('showSwitcher: false')
    expect(nuxt).toContain('showManagement: false')
    expect(nuxt).toContain('@fyit/crouton-pages')

    // C2 — the page settings sit under runtimeConfig.public (a top-level key is ignored).
    expect(nuxt.match(/croutonPages:/g)).toHaveLength(1)
    expect(nuxt).toMatch(/runtimeConfig: \{\s*public: \{\s*croutonPages: \{\s*hideLocaleInUrl: true,[\s\S]*?appDomains: \[\]/)

    // C2 — one locale.
    const crouton = find(files, 'crouton.config.js')
    expect(crouton).toContain('locales: [\'en\']')
    expect(crouton).toContain('defaultLocale: \'en\'')

    // C3 — no pages, middleware or routingMode of its own.
    expect(files.filter(f => f.path.startsWith('app/pages/') || f.path.startsWith('server/middleware/'))).toEqual([])
    expect(files.filter(f => f.content.includes('routingMode'))).toEqual([])
  })

  // covers: T1
  it('lists crouton-pages once when --features pages is also given', async () => {
    const { files } = await scaffoldApp('demo-site', { features: ['pages'], site: true, dryRun: true, outDir: '/tmp/crouton-site' })
    const nuxt = find(files, 'nuxt.config.ts')
    expect(nuxt.match(/'@fyit\/crouton-pages'/g)).toHaveLength(1)
    expect(find(files, 'package.json').match(/"@fyit\/crouton-pages"/g)).toHaveLength(1)
  })
})
