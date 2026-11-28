import { describe, it, expect } from 'vitest'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

// #3930 owner rule (19 Nov): the daily reminder timer runs ONLY on the deployed
// Cloudflare build. These load the REAL Nuxt configs (fresh child process per case, so
// NODE_ENV / NITRO_PRESET are read the way `nuxt dev` / `nuxt build` read them) and the
// REAL wrangler resolution after the real injectWranglerEnv step.
const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '../../..')
const pkgDir = resolve(here, '..')
const VELO = join(root, 'apps/velo')
const BOOKINGS_APPS = ['apps/velo', 'pocs/booking-demo', 'pocs/crouton-builder', 'pocs/gallery', 'fixtures/with-bookings']
const SCHEDULE = { '0 7 * * *': ['bookings:scheduled-emails'] }

const LOAD = `
import { createRequire } from 'node:module'
const dir = process.argv[1]
const { loadNuxtConfig } = await import(createRequire(dir + '/package.json').resolve('@nuxt/kit'))
const c = await loadNuxtConfig({ cwd: dir })
process.stdout.write('\\n@@' + JSON.stringify({ scheduledTasks: c.nitro?.scheduledTasks ?? null, tasksOn: c.nitro?.experimental?.tasks ?? null, tasks: c.nitro?.tasks ?? null }))
`

function loadConfig(appDir: string, env: { NODE_ENV: string, NITRO_PRESET?: string }) {
  const childEnv: Record<string, string | undefined> = { ...process.env, NODE_ENV: env.NODE_ENV }
  delete childEnv.NITRO_PRESET
  if (env.NITRO_PRESET) childEnv.NITRO_PRESET = env.NITRO_PRESET
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', LOAD, join(root, appDir)], { env: childEnv, encoding: 'utf8', timeout: 60_000 })
  const line = r.stdout.split('\n').find(l => l.startsWith('@@'))
  if (!line) throw new Error(`could not load ${appDir} config: ${r.stderr}`)
  return JSON.parse(line.slice(2)) as { scheduledTasks: Record<string, string[]> | null, tasksOn: boolean | null, tasks: Record<string, { handler: string }> | null }
}

const hasSchedule = (s: Record<string, string[]> | null) => !!s && Object.keys(s).length > 0

describe('the daily booking email timer is scheduled only on the Cloudflare production build (#3930)', () => {
  it('T14: the package config itself never schedules it', () => {
    expect(readFileSync(join(pkgDir, 'nuxt.config.ts'), 'utf8')).not.toMatch(/scheduledTasks/)
  })

  for (const app of BOOKINGS_APPS) {
    it(`T14: ${app} — nuxt dev has no scheduled task, even with a Cloudflare preset set`, () => {
      expect(hasSchedule(loadConfig(app, { NODE_ENV: 'development' }).scheduledTasks)).toBe(false)
      expect(hasSchedule(loadConfig(app, { NODE_ENV: 'development', NITRO_PRESET: 'cloudflare_module' }).scheduledTasks)).toBe(false)
    }, 60_000)
  }

  it('T14: a local velo production build without a preset has no scheduled task', () => {
    expect(hasSchedule(loadConfig('apps/velo', { NODE_ENV: 'production' }).scheduledTasks)).toBe(false)
  }, 60_000)

  it('T15: velo\'s Cloudflare production build schedules exactly the daily job, and its handler exists', () => {
    const c = loadConfig('apps/velo', { NODE_ENV: 'production', NITRO_PRESET: 'cloudflare_module' })
    expect(c.scheduledTasks).toEqual(SCHEDULE)
    expect(c.tasksOn).toBe(true)
    const handler = c.tasks?.['bookings:scheduled-emails']?.handler
    expect(handler && existsSync(handler)).toBe(true)
  }, 60_000)

  for (const app of BOOKINGS_APPS.filter(a => a !== 'apps/velo')) {
    it(`T15: ${app} — its Cloudflare production build has no schedule (booking email is off there)`, () => {
      expect(hasSchedule(loadConfig(app, { NODE_ENV: 'production', NITRO_PRESET: 'cloudflare_module' }).scheduledTasks)).toBe(false)
    }, 60_000)
  }

  it('T9: Wrangler resolves velo production to the scheduled crons and staging to none', async () => {
    const wrangler = createRequire(join(pkgDir, 'package.json'))('wrangler')
    const { rawConfig } = wrangler.experimental_readRawConfig({ config: join(VELO, 'wrangler.jsonc') })
    // Stand-in for Nitro's build output: top-level keys copied, env dropped (nitro#3429)
    const tmp = mkdtempSync(join(tmpdir(), 'velo-cron-'))
    copyFileSync(join(VELO, 'wrangler.jsonc'), join(tmp, 'wrangler.jsonc'))
    mkdirSync(join(tmp, '.output/server'), { recursive: true })
    const { env: _env, ...top } = rawConfig
    writeFileSync(join(tmp, '.output/server/index.mjs'), '')
    writeFileSync(join(tmp, '.output/server/wrangler.json'), JSON.stringify({ ...top, main: 'index.mjs' }))
    const { injectWranglerEnv } = await import(join(root, 'scripts/lib/inject-wrangler-env.mjs'))
    injectWranglerEnv(tmp)

    const built = join(tmp, '.output/server/wrangler.json')
    const prodCrons = wrangler.unstable_readConfig({ config: built }).triggers?.crons
    const stagingCrons = wrangler.unstable_readConfig({ config: built, env: 'staging' }).triggers?.crons
    const scheduled = loadConfig('apps/velo', { NODE_ENV: 'production', NITRO_PRESET: 'cloudflare_module' }).scheduledTasks
    expect(prodCrons).toEqual(Object.keys(scheduled ?? {}))
    expect(prodCrons).toEqual(['0 7 * * *'])
    expect(stagingCrons).toEqual([])
  }, 60_000)
})
