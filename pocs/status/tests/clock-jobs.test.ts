import { describe, it, expect, vi, afterEach } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { execFileSync } from 'node:child_process'
import { CLOCK_JOBS, dueJobs } from '../server/utils/clock-jobs'
import { onTick } from '../server/utils/clock-tick'

const at = (iso: string) => new Date(iso)
const names = (d: Date) => dueJobs(d).map(j => j.workflow)
const REPO_ROOT = resolve(__dirname, '../../..')
const WF_DIR = resolve(REPO_ROOT, '.github/workflows')

describe('dueJobs', () => {
  // covers: T1
  it('each 10-minute slot starts only the job whose minute falls in it', () => {
    expect(names(at('2026-11-18T10:10:00Z'))).toEqual(['automerge-epic-subpr.yml'])
    expect(names(at('2026-11-18T10:20:00Z'))).toEqual(['pipeline-metrics.yml'])
    expect(names(at('2026-11-18T10:40:00Z'))).toEqual(['handoff-sweep.yml'])
    for (const m of ['00', '30', '50']) expect(names(at(`2026-11-18T10:${m}:00Z`))).toEqual([])
  })

  // covers: T2
  it('a tick at 19:59 starts automerge; one at 20:00 does not start it again', () => {
    expect(names(at('2026-11-18T10:19:59Z'))).toEqual(['automerge-epic-subpr.yml'])
    expect(names(at('2026-11-18T10:20:00Z'))).not.toContain('automerge-epic-subpr.yml')
  })

  // covers: T3
  it('over one day of 144 slots each hourly job is due exactly 24 times', () => {
    const counts: Record<string, number> = {}
    const day = Date.UTC(2026, 10, 18)
    for (let i = 0; i < 144; i++) {
      for (const j of dueJobs(new Date(day + i * 10 * 60_000))) counts[j.workflow] = (counts[j.workflow] ?? 0) + 1
    }
    for (const j of CLOCK_JOBS.filter(j => j.every === 'hour')) expect(counts[j.workflow]).toBe(24)
  })

  // covers: #4170 T1
  it('over November 2026 (4320 slots) each daily job is due 30 times, weekly 5 (Mondays), skills-digest once', () => {
    const counts: Record<string, number> = {}
    const when: Record<string, string[]> = {}
    const start = Date.UTC(2026, 10, 1)
    for (let i = 0; i < 4320; i++) {
      const slot = new Date(start + i * 10 * 60_000)
      for (const j of dueJobs(slot)) {
        counts[j.workflow] = (counts[j.workflow] ?? 0) + 1
        ;(when[j.workflow] ??= []).push(slot.toISOString())
      }
    }
    const daily = CLOCK_JOBS.filter(j => j.every === 'day')
    expect(daily.map(j => j.workflow).sort()).toEqual([
      'e2e.yml', 'epic-digest.yml', 'housekeeping.yml', 'label-ready-epics.yml',
      'pi-key-canary.yml', 'pipeline-review.yml', 'quality-digest.yml', 'sync-changelogs.yml'
    ])
    for (const j of daily) expect(counts[j.workflow], j.workflow).toBe(30)
    expect(when['weekly.yml']).toEqual(
      ['02', '09', '16', '23', '30'].map(d => `2026-11-${d}T06:30:00.000Z`)
    )
    expect(when['skills-digest.yml']).toEqual(['2026-11-01T05:00:00.000Z'])
  })

  // covers: #4170 T2
  it('two jobs at the same time are both due in that slot, and not in the next', () => {
    expect(names(at('2026-11-18T05:00:00Z'))).toEqual(['epic-digest.yml', 'label-ready-epics.yml'])
    expect(names(at('2026-11-18T05:09:59Z'))).toEqual(['epic-digest.yml', 'label-ready-epics.yml'])
    expect(names(at('2026-11-18T05:10:00Z'))).not.toContain('epic-digest.yml')
    expect(names(at('2026-11-18T05:10:00Z'))).not.toContain('label-ready-epics.yml')
    // a daily job is not due at its minute in another hour
    expect(names(at('2026-11-18T06:00:00Z'))).not.toContain('epic-digest.yml')
  })

  // covers: #4170 T3
  it('every job names a workflow with workflow_dispatch, a boolean clock input and no schedule', () => {
    for (const j of CLOCK_JOBS) {
      const yml = readFileSync(resolve(WF_DIR, j.workflow), 'utf8')
      expect(yml, j.workflow).toMatch(/^ {2}workflow_dispatch:(\s*#.*)?$/m)
      expect(yml, j.workflow).toMatch(/^ {6}clock:\n {8}description: .+\n {8}type: boolean\n {8}default: false$/m)
      expect(yml, j.workflow).not.toMatch(/^ {2}schedule:/m)
      if (j.every !== 'hour') expect(Number.isInteger(j.hour) && j.hour! >= 0 && j.hour! <= 23, j.workflow).toBe(true)
      if (j.every === 'week') expect(Number.isInteger(j.weekday) && j.weekday! >= 0 && j.weekday! <= 6, j.workflow).toBe(true)
      if (j.every === 'month') expect(Number.isInteger(j.day) && j.day! >= 1 && j.day! <= 31, j.workflow).toBe(true)
    }
  })
})

describe('a clock run gates like a timed run', () => {
  const DIGESTS = ['epic-digest.yml', 'housekeeping.yml', 'quality-digest.yml', 'skills-digest.yml']
  const files = [...new Set([...CLOCK_JOBS.map(j => j.workflow), ...DIGESTS])]
  // inputs whose defaults already equal the timed run's behaviour
  const SAFE = new Set(['apply', 'pr', 'threshold', 'dry_run', 'since', 'until', 'max_calls'])

  // covers: #4170 T5 (i)
  it('every FORCE line checks !inputs.clock; no other dispatch branch reads an unsafe input', () => {
    let forceLines = 0
    for (const f of files) {
      const lines = readFileSync(resolve(WF_DIR, f), 'utf8').split('\n')
      for (const [i, line] of lines.entries()) {
        if (/^\s*FORCE:/.test(line)) {
          forceLines++
          expect(line, `${f}:${i + 1}`).toContain('!inputs.clock')
          continue
        }
        if (!line.includes("github.event_name == 'workflow_dispatch'")) continue
        for (const m of line.matchAll(/inputs\.(\w+)/g)) expect(SAFE.has(m[1]!), `${f}:${i + 1} reads inputs.${m[1]}`).toBe(true)
      }
    }
    expect(forceLines).toBeGreaterThanOrEqual(DIGESTS.length)
  })

  // covers: #4170 T5 (ii)
  it('schedule.mjs: quality-digest on a Tuesday does not send unforced, and does when forced', () => {
    const run = (force: string) => {
      try {
        return execFileSync('node', ['.claude/skills/housekeeping/schedule.mjs', 'quality-digest'], {
          cwd: REPO_ROOT,
          env: { ...process.env, FORCE: force, SCHEDULE_TODAY: '2026-11-17', GITHUB_OUTPUT: '' },
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'pipe']
        })
      } catch (e: any) {
        return `${e.stdout ?? ''}${e.stderr ?? ''}`
      }
    }
    expect(run('0')).toMatch(/send=false/)
    expect(run('1')).toMatch(/send=true/)
  })

  // covers: T4
  it('every job has a valid minute and names a dispatchable workflow with no schedule', () => {
    for (const j of CLOCK_JOBS) {
      expect(Number.isInteger(j.minute) && j.minute >= 0 && j.minute <= 59).toBe(true)
      const file = resolve(WF_DIR, j.workflow)
      expect(existsSync(file), j.workflow).toBe(true)
      const yml = readFileSync(file, 'utf8')
      expect(yml, j.workflow).toMatch(/^ {2}workflow_dispatch:/m)
      expect(yml, j.workflow).not.toMatch(/^ {2}schedule:/m)
    }
  })
})

async function pkcs8Pem(): Promise<string> {
  const kp = await crypto.subtle.generateKey(
    { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
    true,
    ['sign', 'verify']
  )
  const der = new Uint8Array(await crypto.subtle.exportKey('pkcs8', kp.privateKey))
  let bin = ''
  for (const b of der) bin += String.fromCharCode(b)
  return `-----BEGIN PRIVATE KEY-----\n${btoa(bin).match(/.{1,64}/g)!.join('\n')}\n-----END PRIVATE KEY-----`
}

describe('onTick', () => {
  afterEach(() => vi.restoreAllMocks())
  const slot10 = Date.parse('2026-11-18T10:10:00Z')

  // covers: T5
  it('makes no call unless CLOCK_ENABLED is "1"', async () => {
    const f = vi.fn()
    expect(await onTick(slot10, {}, f as any)).toEqual([])
    expect(await onTick(slot10, { CLOCK_ENABLED: '0' }, f as any)).toEqual([])
    expect(f).not.toHaveBeenCalled()
  })

  // covers: T5
  it('when enabled, mints one token and dispatches ref main to each due workflow; a 500 neither throws nor stops the next', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {})
    const env = { CLOCK_ENABLED: '1', HARNESS_APP_ID: '1', HARNESS_APP_PRIVATE_KEY: await pkcs8Pem(), HARNESS_APP_INSTALLATION_ID: '42' }
    const f = vi.fn(async (url: string) => {
      if (url.includes('/access_tokens')) return { ok: true, status: 201, json: async () => ({ token: 'tok' }) }
      if (url.includes('automerge')) return { ok: false, status: 500, statusText: 'Server Error' }
      return { ok: true, status: 204 }
    })

    // one job due: posts ref main to its dispatches URL with the minted token
    const r1 = await onTick(Date.parse('2026-11-18T10:20:00Z'), env, f as any)
    expect(r1).toEqual([{ workflow: 'pipeline-metrics.yml', status: 204 }])
    expect(f.mock.calls.filter(c => String(c[0]).includes('/access_tokens'))).toHaveLength(1)
    const [url, init] = f.mock.calls[1] as unknown as [string, RequestInit]
    expect(url).toBe('https://api.github.com/repos/FriendlyInternet/nuxt-crouton/actions/workflows/pipeline-metrics.yml/dispatches')
    expect(init.method).toBe('POST')
    // covers: #4170 T4
    expect(JSON.parse(String(init.body))).toEqual({ ref: 'main', inputs: { clock: 'true' } })
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer tok')

    // a 500 on one dispatch neither throws nor stops the next
    f.mockClear()
    const both = [
      { workflow: 'automerge-epic-subpr.yml', every: 'hour' as const, minute: 11, since: '2026-11-18T18:15:00Z', about: '' },
      { workflow: 'handoff-sweep.yml', every: 'hour' as const, minute: 12, since: '2026-11-18T18:15:00Z', about: '' }
    ]
    CLOCK_JOBS.push(...both)
    try {
      const r2 = await onTick(slot10, env, f as any)
      expect(r2).toEqual([
        { workflow: 'automerge-epic-subpr.yml', status: 500 },
        { workflow: 'automerge-epic-subpr.yml', status: 500 },
        { workflow: 'handoff-sweep.yml', status: 204 }
      ])
      expect(f.mock.calls.filter(c => String(c[0]).includes('/access_tokens'))).toHaveLength(1)
    } finally {
      CLOCK_JOBS.splice(CLOCK_JOBS.length - both.length, both.length)
    }
  })
})
