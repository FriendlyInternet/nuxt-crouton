import { describe, expect, it } from 'vitest'
import { scaffoldApp } from '../../lib/scaffold-app.ts'

const find = (files: Array<{ path: string, content: string }>, p: string) => files.find(f => f.path === p)?.content ?? ''

describe('scaffoldApp layout opt-in (#2282)', () => {
  it('--features layout extends and depends on crouton-layout', async () => {
    const { files } = await scaffoldApp('demo', { features: ['layout'], dryRun: true, outDir: '/tmp/crouton-layout-optin' })
    expect(find(files, 'nuxt.config.ts')).toContain('@fyit/crouton-layout')
    expect(find(files, 'package.json')).toContain('"@fyit/crouton-layout": "workspace:*"')
  })

  it('without the feature, no layout', async () => {
    const { files } = await scaffoldApp('demo', { features: [], dryRun: true, outDir: '/tmp/crouton-layout-optin' })
    expect(find(files, 'nuxt.config.ts')).not.toContain('crouton-layout')
    expect(find(files, 'package.json')).not.toContain('crouton-layout')
  })
})
