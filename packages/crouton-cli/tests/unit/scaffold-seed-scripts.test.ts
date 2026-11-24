import { describe, it, expect } from 'vitest'
import { scaffoldApp } from '../../lib/scaffold-app'

// #4377 — a CF scaffold ships the seed scripts `pnpm preview` calls (`db:seed`).
describe('scaffold db:seed scripts (#4377)', () => {
  it('T3. cf scaffold → db:seed / db:seed:staging run crouton-seed against the app dbs', async () => {
    const { files } = await scaffoldApp('demo', { outDir: '/tmp/crouton-4377-seed-scripts', dryRun: true, cf: true })
    const pkg = JSON.parse(files.find(f => f.path === 'package.json')!.content)
    expect(pkg.scripts['db:seed']).toBe('crouton-seed --db demo-db')
    expect(pkg.scripts['db:seed:staging']).toBe('crouton-seed --db demo-staging-db --remote')
  })

  it('non-cf scaffold has no db name, so no seed scripts', async () => {
    const { files } = await scaffoldApp('demo', { outDir: '/tmp/crouton-4377-seed-scripts-nocf', dryRun: true, cf: false })
    const pkg = JSON.parse(files.find(f => f.path === 'package.json')!.content)
    expect(pkg.scripts['db:seed']).toBeUndefined()
  })
})
