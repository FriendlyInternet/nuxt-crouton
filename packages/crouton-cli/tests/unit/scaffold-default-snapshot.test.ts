import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { scaffoldApp } from '../../lib/scaffold-app.ts'

// #4263 C4 — a scaffold WITHOUT --site is byte-identical to the one before --site
// existed. Captured on the unchanged code; the only masked values are the ones
// that change per run or per release: the .env auth secret, `scaffoldedAt` and
// `cliVersion` (read from the CLI's package.json, so it moves on every release).
// The `scripts/*.mjs` files are copied verbatim from lib/templates (no vars), so
// they are pinned by sha256 to keep the snapshot readable.
function mask(files: Array<{ path: string, content: string }>): Array<[string, string]> {
  return files.map(({ path, content }) => {
    if (/^scripts\/.*\.mjs$/.test(path)) return [path, `sha256:${createHash('sha256').update(content).digest('hex')}`]
    let c = content
    if (path === '.env') c = c.replace(/BETTER_AUTH_SECRET=[0-9a-f]+/, 'BETTER_AUTH_SECRET=<masked>')
    if (path === '.crouton.json') {
      c = c
        .replace(/"scaffoldedAt": "[^"]*"/, '"scaffoldedAt": "<masked>"')
        .replace(/"cliVersion": "[^"]*"/, '"cliVersion": "<masked>"')
    }
    return [path, c]
  })
}

describe('scaffoldApp default output is unchanged by --site (#4263)', () => {
  // covers: T2
  it('app scaffold (no --site) matches the committed snapshot', async () => {
    const { files } = await scaffoldApp('demo-plain', { dryRun: true, outDir: '/tmp/crouton-plain' })
    expect(mask(files)).toMatchSnapshot()
  })

  // covers: T2
  it('poc scaffold (no --site) matches the committed snapshot', async () => {
    const { files } = await scaffoldApp('demo-plain', { dryRun: true, outDir: 'pocs/demo-plain' })
    expect(mask(files)).toMatchSnapshot()
  })
})
