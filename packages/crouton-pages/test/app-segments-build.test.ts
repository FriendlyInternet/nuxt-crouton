// @vitest-environment node
/**
 * #4175 — every package's top-level pages, plus one the app adds, reach the
 * server list. Loads velo with Nuxt's own loader (prepare mode, build dir in a
 * tmp dir) and evaluates the `#crouton-pages/app-segments` Nitro virtual module
 * the crouton-pages inline module registers.
 *
 * The Nuxt boot runs in a separate plain `node` process, not in this vitest
 * worker: v8 coverage only measures the worker, so the many module.ts /
 * nuxt.config.ts files Nuxt loads never reach the coverage report (loading
 * them in-process double-loaded them and produced negative branch counts the
 * fallow audit cannot parse). Same real code path, just another process.
 */
import { describe, it, expect } from 'vitest'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'

const run = promisify(execFile)
const pkgDir = fileURLToPath(new URL('..', import.meta.url))
const veloDir = fileURLToPath(new URL('../../../apps/velo', import.meta.url))
const pageFile = fileURLToPath(new URL('./stubs/app-segments.ts', import.meta.url))

// Runs as an ES module with cwd = this package, so `nuxt/kit` resolves from here.
const script = `
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildNuxt, loadNuxt } from 'nuxt/kit'
const [veloDir, pageFile] = process.argv.slice(-2)
const buildDir = mkdtempSync(join(tmpdir(), 'crouton-pages-segments-'))
const nuxt = await loadNuxt({
  cwd: veloDir,
  overrides: {
    _prepare: true,
    buildDir,
    modules: [
      (_options, n) => {
        n.hook('pages:extend', (pages) => {
          pages.push({ path: '/my-app-page', name: 'my-app-page', file: pageFile })
        })
      }
    ]
  }
})
try {
  await buildNuxt(nuxt)
  const source = await nuxt.options.nitro.virtual['#crouton-pages/app-segments']()
  process.stdout.write('\\n@@SEGMENTS@@' + source.replace(/^export const appPageSegments = /, '') + '\\n')
}
finally {
  await nuxt.close()
  rmSync(buildDir, { recursive: true, force: true })
}
process.exit(0)
`

describe('#crouton-pages/app-segments (real page tree)', () => {
  it('lists every package top-level page and an app-added page', async () => {
    const { stdout } = await run(process.execPath, ['--input-type=module', '-e', script, veloDir, pageFile], {
      cwd: pkgDir,
      maxBuffer: 64 * 1024 * 1024,
      env: Object.fromEntries(Object.entries(process.env).filter(([k]) => k !== 'NODE_V8_COVERAGE'))
    })
    const line = stdout.split('\n').find(l => l.startsWith('@@SEGMENTS@@'))
    expect(line, 'child process printed the segment list').toBeDefined()
    const list = JSON.parse(line!.slice('@@SEGMENTS@@'.length)) as string[]
    for (const seg of ['account', 'onboarding', 'admin', 'auth', 'super-admin', 'my-app-page']) {
      expect(list, seg).toContain(seg)
    }
    expect(list.some(s => s.includes(':'))).toBe(false)
  }, 120_000)
})
