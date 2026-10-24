/**
 * createAuth — the config handed to better-auth (#2339)
 *
 * The builders in server/lib/auth.ts decide which login methods exist and which
 * origins may call login. They're module-private, so we drive them through the
 * public `createAuth()` and assert on what reaches the (mocked) `betterAuth()`.
 * Plugin factories are mocked to echo their options, so a plugin shows up as
 * `{ type, config }` in the list.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { CroutonAuthConfig } from '../../../types/config'

import { createAuth } from '../../../server/lib/auth'

const mockBetterAuth = vi.fn((config: unknown) => ({ config }))

vi.mock('better-auth', () => ({
  betterAuth: (config: unknown) => mockBetterAuth(config)
}))

vi.mock('better-auth/plugins', () => ({
  organization: (config: unknown) => ({ type: 'organization', config }),
  admin: (config: unknown) => ({ type: 'admin', config }),
  twoFactor: (config: unknown) => ({ type: 'twoFactor', config }),
  magicLink: (config: unknown) => ({ type: 'magicLink', config }),
  haveIBeenPwned: (config: unknown) => ({ type: 'haveIBeenPwned', config })
}))

vi.mock('@better-auth/i18n', () => ({
  i18n: (config: unknown) => ({ type: 'i18n', config })
}))

vi.mock('@better-auth/passkey', () => ({
  passkey: (config: unknown) => ({ type: 'passkey', config })
}))

vi.mock('better-auth/adapters/drizzle', () => ({
  drizzleAdapter: () => ({ type: 'drizzle' })
}))

vi.mock('nitropack/runtime', () => ({
  useNitroApp: () => ({ hooks: { callHook: vi.fn().mockResolvedValue(undefined) } })
}))

type Plugin = { type: string, config: Record<string, any> }
type BuiltConfig = {
  emailAndPassword: Record<string, any>
  socialProviders?: Record<string, Record<string, any>>
  trustedOrigins: (request?: Request) => string[]
  plugins: Plugin[]
}

function build(config: CroutonAuthConfig = {}, baseURL = 'https://velo.pmcp.dev'): BuiltConfig {
  createAuth({ config, db: {} as never, secret: 'test-secret', baseURL })
  return mockBetterAuth.mock.calls.at(-1)![0] as BuiltConfig
}

const pluginTypes = (c: BuiltConfig) => c.plugins.map(p => p.type)
const plugin = (c: BuiltConfig, type: string) => c.plugins.find(p => p.type === type)

describe('createAuth config', () => {
  const env = { ...process.env }

  beforeEach(() => {
    mockBetterAuth.mockClear()
    process.env.NODE_ENV = 'production'
    delete process.env.BETTER_AUTH_TRUSTED_ORIGINS
  })

  afterEach(() => {
    process.env = { ...env }
  })

  describe('trusted origins', () => {
    it('trusts only the base URL origin in production', () => {
      expect(build().trustedOrigins()).toEqual(['https://velo.pmcp.dev'])
    })

    it('adds the origin the request was served from', () => {
      const origins = build().trustedOrigins(new Request('https://velo.friendlyinter.net/api/auth/sign-in/email'))
      expect(origins).toEqual(['https://velo.pmcp.dev', 'https://velo.friendlyinter.net'])
    })

    it('falls back to the static list for an unparseable request URL', () => {
      const origins = build().trustedOrigins({ url: 'not a url' } as Request)
      expect(origins).toEqual(['https://velo.pmcp.dev'])
    })

    it('adds a wildcard for Cloudflare Pages preview subdomains', () => {
      expect(build({}, 'https://kassa.pages.dev').trustedOrigins())
        .toContain('https://*.kassa.pages.dev')
    })

    it('adds trimmed BETTER_AUTH_TRUSTED_ORIGINS, in production too', () => {
      process.env.BETTER_AUTH_TRUSTED_ORIGINS = 'https://a.example.com, https://b.example.com'
      expect(build().trustedOrigins())
        .toEqual(['https://velo.pmcp.dev', 'https://a.example.com', 'https://b.example.com'])
    })

    it('never trusts localhost in production', () => {
      expect(build().trustedOrigins().some(o => o.includes('localhost'))).toBe(false)
    })

    it('trusts local dev ports outside production', () => {
      process.env.NODE_ENV = 'development'
      expect(build().trustedOrigins()).toContain('http://localhost:3000')
    })
  })

  describe('plugins', () => {
    it('always enables organization, admin and i18n — and nothing optional by default', () => {
      expect(pluginTypes(build())).toEqual(['organization', 'admin', 'i18n'])
    })

    it('maps the admin plugin fields onto our column names (better-auth 1.7 500s without it, #2223)', () => {
      expect(plugin(build(), 'admin')!.config.schema).toEqual({
        user: { fields: { banReason: 'bannedReason', banExpires: 'bannedUntil' } },
        session: { fields: { impersonatedBy: 'impersonatingFrom' } }
      })
    })

    it('passkeys: true → relying party is the base URL host', () => {
      expect(plugin(build({ methods: { passkeys: true } }), 'passkey')!.config).toEqual({
        rpID: 'velo.pmcp.dev',
        rpName: 'Application',
        origin: 'https://velo.pmcp.dev'
      })
    })

    it('passkeys: custom rpId/rpName are used', () => {
      const config = plugin(build({ methods: { passkeys: { rpId: 'pmcp.dev', rpName: 'Velo' } } }), 'passkey')!.config
      expect(config).toMatchObject({ rpID: 'pmcp.dev', rpName: 'Velo', origin: 'https://velo.pmcp.dev' })
    })

    it('passkeys: { enabled: false } adds no passkey plugin', () => {
      expect(pluginTypes(build({ methods: { passkeys: { enabled: false } } }))).not.toContain('passkey')
    })

    it('twoFactor: true → TOTP 6 digits / 30s, 10 backup codes, issuer from appName', () => {
      expect(plugin(build({ appName: 'Velo', methods: { twoFactor: true } }), 'twoFactor')!.config).toEqual({
        issuer: 'Velo',
        totpOptions: { digits: 6, period: 30 },
        backupCodeOptions: { amount: 10, length: 10 }
      })
    })

    it('twoFactor: custom issuer and backup code count win over defaults', () => {
      const config = plugin(build({ appName: 'Velo', methods: { twoFactor: { issuer: 'Velo Admin', backupCodesCount: 5 } } }), 'twoFactor')!.config
      expect(config).toMatchObject({ issuer: 'Velo Admin', backupCodeOptions: { amount: 5, length: 10 } })
    })

    it('twoFactor: { enabled: false } adds no two-factor plugin', () => {
      expect(pluginTypes(build({ methods: { twoFactor: { enabled: false } } }))).not.toContain('twoFactor')
    })

    it('magicLink: true → 5 minute links; a custom expiresIn is kept', () => {
      expect(plugin(build({ methods: { magicLink: true } }), 'magicLink')!.config.expiresIn).toBe(300)
      expect(plugin(build({ methods: { magicLink: { expiresIn: 900 } } }), 'magicLink')!.config.expiresIn).toBe(900)
    })
  })

  describe('email and password', () => {
    it('is on by default with an 8 character minimum and password reset', () => {
      const { emailAndPassword } = build()
      expect(emailAndPassword).toMatchObject({ enabled: true, autoSignIn: true, minPasswordLength: 8 })
      expect(emailAndPassword.sendResetPassword).toBeTypeOf('function')
    })

    it('password: false turns it off', () => {
      expect(build({ methods: { password: false } }).emailAndPassword).toEqual({ enabled: false })
    })

    it('custom minLength is used and resetEnabled: false removes password reset', () => {
      const { emailAndPassword } = build({ methods: { password: { minLength: 12, resetEnabled: false } } })
      expect(emailAndPassword.minPasswordLength).toBe(12)
      expect(emailAndPassword.sendResetPassword).toBeUndefined()
    })
  })

  describe('social providers', () => {
    it('are absent when no OAuth is configured', () => {
      expect(build().socialProviders).toBeUndefined()
    })

    it('GitHub always requests user:email; Google asks for offline access and an account picker', () => {
      const { socialProviders } = build({
        methods: {
          oauth: {
            github: { clientId: 'gh', clientSecret: 's', scopes: ['read:org'] },
            google: { clientId: 'go', clientSecret: 's', allowSignUp: false }
          }
        }
      })
      expect(socialProviders!.github).toMatchObject({ clientId: 'gh', scope: ['user:email', 'read:org'], disableSignUp: false })
      expect(socialProviders!.google).toMatchObject({ clientId: 'go', accessType: 'offline', prompt: 'select_account', disableSignUp: true })
      expect(Object.keys(socialProviders!)).toEqual(['github', 'google'])
    })
  })
})
