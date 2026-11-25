/**
 * #3143 — an invite run through the REAL crouton-email listener must never
 * write the invitee's email or the invite id (the secret in the accept link)
 * to the server logs, with `debug` off or on.
 */
import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest'

vi.mock('../server/utils/senders', () => ({
  sendVerificationLink: vi.fn(),
  sendPasswordReset: vi.fn(),
  sendTeamInvite: vi.fn(async () => ({ success: true, id: 'resend_1' })),
  sendMagicLink: vi.fn()
}))
vi.mock('../server/utils/template-renderer', () => ({ getEmailBrandConfig: vi.fn(() => ({ appUrl: 'https://app.test' })) }))
vi.mock('../server/utils/resolve-email-settings', () => ({ resolveEmailOverrides: vi.fn(async () => undefined) }))

let debug = false
let listener: (nitroApp: any) => void

function makeNitroApp() {
  const handlers = new Map<string, Array<(p: any) => Promise<void>>>()
  return {
    hooks: {
      hook: (name: string, fn: any) => { handlers.set(name, [...(handlers.get(name) ?? []), fn]) },
      callHook: async (name: string, payload: any) => { for (const fn of handlers.get(name) ?? []) await fn(payload) }
    }
  }
}

const invite = {
  type: 'invitation',
  to: 'alice@example.com',
  invitationId: 'inv_123',
  organizationName: 'Acme',
  inviterName: 'Bob',
  inviterEmail: 'bob@example.com',
  role: 'member',
  expiresAt: new Date()
}

async function sendInviteAndCollectLogs() {
  const log = vi.spyOn(console, 'log').mockImplementation(() => {})
  const error = vi.spyOn(console, 'error').mockImplementation(() => {})
  const nitroApp = makeNitroApp()
  listener(nitroApp)
  await nitroApp.hooks.callHook('crouton:auth:email', invite)
  return [...log.mock.calls, ...error.mock.calls].flat().map(a => typeof a === 'string' ? a : JSON.stringify(a) ?? String(a))
}

beforeAll(async () => {
  vi.stubGlobal('defineNitroPlugin', (fn: any) => fn)
  vi.stubGlobal('useRuntimeConfig', () => ({ public: { crouton: { auth: { debug } } } }))
  listener = (await import('../server/plugins/auth-email-listener')).default as any
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('auth-email-listener invite logging', () => {
  it.each([false, true])('debug=%s: no log line carries the invitee email or invite id', async (on) => {
    debug = on
    const args = await sendInviteAndCollectLogs()
    expect(args.length).toBeGreaterThan(0) // the plugin-registered line proves we captured logs
    for (const a of args) {
      expect(a).not.toContain('alice@example.com')
      expect(a).not.toContain('inv_123')
    }
  })
})
