/**
 * auth-email-listener must not log invitee data outside debug (#3138 R3)
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('../server/utils/senders', () => ({
  sendVerificationLink: vi.fn(),
  sendPasswordReset: vi.fn(),
  sendTeamInvite: vi.fn(async () => ({ success: true, to: 'invitee@example.com' })),
  sendMagicLink: vi.fn()
}))
vi.mock('../server/utils/template-renderer', () => ({ getEmailBrandConfig: () => ({ appUrl: 'https://app.example.com' }) }))
vi.mock('../server/utils/resolve-email-settings', () => ({ resolveEmailOverrides: async () => undefined }))

let handler: (payload: any) => Promise<void>
let debug = false

beforeEach(() => {
  vi.stubGlobal('defineNitroPlugin', (fn: any) => fn)
  vi.stubGlobal('useRuntimeConfig', () => ({ public: { crouton: { auth: { debug } } } }))
  vi.stubGlobal('getRequestURL', () => new URL('https://app.example.com'))
  vi.stubGlobal('resolveTeamBrandFromHost', async () => undefined)
})
afterEach(() => vi.restoreAllMocks())

async function run(withDebug: boolean) {
  debug = withDebug
  const spies = [vi.spyOn(console, 'log'), vi.spyOn(console, 'error'), vi.spyOn(console, 'warn')]
  spies.forEach(s => s.mockImplementation(() => {}))
  const plugin = (await import('../server/plugins/auth-email-listener')).default as any
  plugin({ hooks: { hook: (_n: string, fn: any) => { if (_n === 'crouton:auth:email') handler = fn }, callHook: async () => {} } })
  await handler({
    type: 'invitation', to: 'invitee@example.com', invitationId: 'invite-id-123',
    organizationName: 'Acme', inviterName: 'Boss', role: 'member'
  })
  return spies.flatMap(s => s.mock.calls).map(c => c.map(a => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ')).join('\n')
}

describe('auth-email-listener logging', () => {
  it('logs neither the invitee address nor the invite id / accept link outside debug', async () => {
    const out = await run(false)
    expect(out).not.toContain('invitee@example.com')
    expect(out).not.toContain('invite-id-123')
  })

  it('logs them with debug on', async () => {
    expect(await run(true)).toContain('invite-id-123')
  })
})
