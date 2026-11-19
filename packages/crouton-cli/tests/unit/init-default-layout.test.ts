import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// #3956 — `crouton init` adds @fyit/crouton-layout by default; `--no-layout`
// (layout: false) leaves it out. scaffoldApp itself is unchanged.

vi.mock('../../lib/scaffold-app.ts', () => ({
  scaffoldApp: vi.fn(async () => ({ files: [], appDir: 'apps/demo' }))
}))

const { initApp, initFeatures } = await import('../../lib/init-app.ts')
const { scaffoldApp } = await import('../../lib/scaffold-app.ts')

const find = (files: Array<{ path: string, content: string }>, p: string) => files.find(f => f.path === p)?.content ?? ''

describe('crouton init adds crouton-layout by default (#3956)', () => {
  beforeEach(() => {
    vi.mocked(scaffoldApp).mockClear()
    vi.spyOn(console, 'log').mockImplementation(() => {})
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  const passedFeatures = () => (vi.mocked(scaffoldApp).mock.calls[0]?.[1] as { features: string[] }).features

  it('passes layout to the scaffold by default', async () => {
    await initApp('demo', { dryRun: true })
    expect(passedFeatures()).toEqual(['layout'])
  })

  it('keeps the given features and appends layout', async () => {
    await initApp('demo', { features: ['bookings'], dryRun: true })
    expect(passedFeatures()).toEqual(['bookings', 'layout'])
  })

  it('layout: false (--no-layout) leaves it out', async () => {
    await initApp('demo', { features: ['bookings'], layout: false, dryRun: true })
    expect(passedFeatures()).toEqual(['bookings'])
  })

  it('an explicit --features layout is not duplicated', async () => {
    await initApp('demo', { features: ['layout'], dryRun: true })
    expect(passedFeatures()).toEqual(['layout'])
    expect(initFeatures(['layout'])).toEqual(['layout'])
  })

  it('the real scaffold of the default extends and depends on crouton-layout', async () => {
    const real = await vi.importActual<typeof import('../../lib/scaffold-app.ts')>('../../lib/scaffold-app.ts')
    const { files } = await real.scaffoldApp('demo', { features: initFeatures([]), dryRun: true, outDir: '/tmp/crouton-init-default-layout' })
    expect(find(files, 'nuxt.config.ts')).toContain('@fyit/crouton-layout')
    expect(find(files, 'package.json')).toContain('"@fyit/crouton-layout": "workspace:*"')
  })

  it('the real scaffold of the opt-out has no crouton-layout', async () => {
    const real = await vi.importActual<typeof import('../../lib/scaffold-app.ts')>('../../lib/scaffold-app.ts')
    const { files } = await real.scaffoldApp('demo', { features: initFeatures([], false), dryRun: true, outDir: '/tmp/crouton-init-default-layout' })
    expect(find(files, 'nuxt.config.ts')).not.toContain('crouton-layout')
    expect(find(files, 'package.json')).not.toContain('crouton-layout')
  })
})
