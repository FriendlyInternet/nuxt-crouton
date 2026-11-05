import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
// @ts-expect-error plain .mjs script
import { discoverApps, outFile } from '../scripts/gen-app-urls.mjs'
import { stagingUrlFor } from '../server/utils/app-urls'

describe('app-urls discovery', () => {
  it('resolves gallery to its staging URL', () => {
    expect(stagingUrlFor('gallery')).toBe('https://gallery-staging.pmcp.dev')
  })

  it('returns null for unknown apps', () => {
    expect(stagingUrlFor('nope')).toBeNull()
    expect(stagingUrlFor('constructor')).toBeNull()
  })

  it('generated file is up to date with every deploy.config.json (run scripts/gen-app-urls.mjs)', () => {
    expect(JSON.parse(readFileSync(outFile, 'utf8'))).toEqual(discoverApps())
  })
})
