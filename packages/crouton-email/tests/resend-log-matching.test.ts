/**
 * #3419 — delivery events must land on the right log row. Runs the REAL webhook
 * handler and the REAL crouton-auth logger plugin against an in-memory SQLite.
 * Rows are matched by Resend's message id only, never by recipient address.
 */
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { authEmailLog } from '../../crouton-auth/server/database/schema/auth'

const secretBytes = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8])
const secret = `whsec_${btoa(String.fromCharCode(...secretBytes))}`
const sqlite = new Database(':memory:')
const db = drizzle(sqlite)

vi.mock('../../crouton-auth/server/utils/database', () => ({
  useDB: () => db,
  tables: { authEmailLog }
}))

vi.mock('../server/utils/senders', () => ({
  sendVerificationLink: vi.fn(),
  sendPasswordReset: vi.fn(),
  sendTeamInvite: vi.fn(),
  sendMagicLink: vi.fn(async () => ({ success: true, id: 're_real_1' }))
}))
vi.mock('../server/utils/template-renderer', () => ({ getEmailBrandConfig: vi.fn() }))
vi.mock('../server/utils/resolve-email-settings', () => ({ resolveEmailOverrides: vi.fn(async () => undefined) }))

const handlers = new Map<string, Array<(p: any) => Promise<void>>>()
const nitroApp = {
  hooks: {
    hook: (name: string, fn: any) => { handlers.set(name, [...(handlers.get(name) ?? []), fn]) },
    callHook: async (name: string, payload: any) => { for (const fn of handlers.get(name) ?? []) await fn(payload) }
  }
}
let raw = ''
let headers: Record<string, string> = {}
let webhook: (e: any) => Promise<any>

async function sign(id: string, ts: string, body: string) {
  const key = await crypto.subtle.importKey('raw', secretBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${id}.${ts}.${body}`))
  return `v1,${btoa(String.fromCharCode(...new Uint8Array(mac)))}`
}

async function deliver(type: string, emailId: string, to: string) {
  raw = JSON.stringify({ type, data: { email_id: emailId, to: [to] } })
  const ts = String(Math.floor(Date.now() / 1000))
  headers = { 'svix-id': 'msg_1', 'svix-timestamp': ts, 'svix-signature': await sign('msg_1', ts, raw) }
  await webhook({})
}

const row = (id: string) => sqlite.prepare('select status, error from auth_email_log where id = ?').get(id) as any

beforeAll(async () => {
  vi.stubGlobal('defineNitroPlugin', (fn: any) => fn)
  vi.stubGlobal('defineEventHandler', (fn: any) => fn)
  vi.stubGlobal('useRuntimeConfig', () => ({ email: { resendWebhookSecret: secret } }))
  vi.stubGlobal('readRawBody', async () => raw)
  vi.stubGlobal('getHeader', (_e: any, k: string) => headers[k])
  vi.stubGlobal('useNitroApp', () => nitroApp)
  vi.stubGlobal('createError', (o: any) => Object.assign(new Error(o.statusMessage), o))
  const logger = (await import('../../crouton-auth/server/plugins/auth-email-logger')).default as any
  logger(nitroApp)
  ;((await import('../server/plugins/auth-email-listener')).default as any)(nitroApp)
  webhook = (await import('../server/api/webhooks/resend.post')).default as any
})

beforeEach(() => {
  sqlite.exec('drop table if exists auth_email_log')
  sqlite.exec(`create table auth_email_log (
    id text primary key, organizationId text, emailType text not null, recipientEmail text not null,
    status text not null default 'pending', error text, sentAt integer, metadata text,
    providerId text, createdAt integer not null)`)
  const ins = sqlite.prepare("insert into auth_email_log (id, emailType, recipientEmail, status, providerId, createdAt) values (?, 'invitation', ?, 'sent', ?, ?)")
  // Same recipient address in two different teams' rows; B is the newest.
  ins.run('team-a', 'shared@example.com', 'resend-a', 1)
  ins.run('team-b', 'shared@example.com', 'resend-b', 2)
})

describe('Resend webhook → auth_email_log', () => {
  it("team A's event updates only team A's row, even with the same address and B newer", async () => {
    await deliver('email.bounced', 'resend-a', 'shared@example.com')
    expect(row('team-a').status).toBe('bounced')
    expect(row('team-b').status).toBe('sent')
  })

  it('an unknown message id updates nothing', async () => {
    await deliver('email.bounced', 'resend-unknown', 'shared@example.com')
    expect(row('team-a').status).toBe('sent')
    expect(row('team-b').status).toBe('sent')
  })

  it('delivered does not overwrite an earlier bounce', async () => {
    await deliver('email.bounced', 'resend-a', 'shared@example.com')
    await deliver('email.delivered', 'resend-a', 'shared@example.com')
    expect(row('team-a').status).toBe('bounced')
  })

  it('real path: listener send stores Resend id on the log row, then the webhook flips sent → delivered', async () => {
    await nitroApp.hooks.callHook('crouton:auth:email', { type: 'magic-link', to: 'real@example.com', url: 'https://x.test/l' })
    const logged = sqlite.prepare("select id, status, providerId from auth_email_log where recipientEmail = 'real@example.com'").get() as any
    expect(logged.status).toBe('sent')
    expect(logged.providerId).toBe('re_real_1')
    await deliver('email.delivered', 're_real_1', 'real@example.com')
    expect(row(logged.id).status).toBe('delivered')
  })
})
