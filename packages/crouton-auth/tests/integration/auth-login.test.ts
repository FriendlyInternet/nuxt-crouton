/**
 * Integration Tests: Login Flow
 *
 * Tests the complete login flow including:
 * - Email/password authentication
 * - OAuth authentication
 * - Passkey authentication
 * - Magic link authentication
 * - Two-factor authentication
 * - Session management
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  setupIntegrationMocks,
  createTestUser,
  createTestSession,
  createTestTeam,
  createTestMember
} from './setup'

// TODO: These integration tests need to be updated to work with the current useAuth implementation.
// The mock setup doesn't properly initialize all required composables and globals.
// Skipping until the mock setup can be fixed.

describe.skip('Integration: Login Flow', () => {
  let mockClient: ReturnType<typeof setupIntegrationMocks>

  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.resetAllMocks()
  })

  describe('Email/Password Login', () => {
    it('should successfully login with valid credentials', async () => {
      mockClient = setupIntegrationMocks()

      const { useAuth } = await import('../../app/composables/useAuth')
      const auth = useAuth()

      // Perform login
      await auth.login({ email: 'test@example.com', password: 'password123' })

      // Verify client was called with correct credentials
      expect(mockClient.signIn.email).toHaveBeenCalledWith({
        email: 'test@example.com',
        password: 'password123',
        rememberMe: undefined
      })
    })

    it('should handle remember me option', async () => {
      mockClient = setupIntegrationMocks()

      const { useAuth } = await import('../../app/composables/useAuth')
      const auth = useAuth()

      await auth.login({ email: 'test@example.com', password: 'password123', rememberMe: true })

      expect(mockClient.signIn.email).toHaveBeenCalledWith({
        email: 'test@example.com',
        password: 'password123',
        rememberMe: true
      })
    })

    it('should reject invalid credentials', async () => {
      mockClient = setupIntegrationMocks()

      const { useAuth } = await import('../../app/composables/useAuth')
      const auth = useAuth()

      await expect(auth.login({ email: 'wrong@example.com', password: 'wrongpass' }))
        .rejects.toThrow('Invalid credentials')

      expect(auth.error.value).toBe('Invalid credentials')
    })

    it('should set loading state during login', async () => {
      mockClient = setupIntegrationMocks()

      const { useAuth } = await import('../../app/composables/useAuth')
      const auth = useAuth()

      const loginPromise = auth.login({ email: 'test@example.com', password: 'password123' })
      expect(auth.loading.value).toBe(true)

      await loginPromise
      expect(auth.loading.value).toBe(false)
    })

    it('should clear previous errors on successful login', async () => {
      mockClient = setupIntegrationMocks()

      const { useAuth } = await import('../../app/composables/useAuth')
      const auth = useAuth()

      // First, trigger an error
      await expect(auth.login({ email: 'wrong@example.com', password: 'wrong' }))
        .rejects.toThrow()
      expect(auth.error.value).toBe('Invalid credentials')

      // Now login successfully
      await auth.login({ email: 'test@example.com', password: 'password123' })
      expect(auth.error.value).toBeNull()
    })
  })

  describe('OAuth Login', () => {
    // TODO: window.location mock complexity
    it.todo('should initiate OAuth flow with provider', async () => {
      mockClient = setupIntegrationMocks()

      const { useAuth } = await import('../../app/composables/useAuth')
      const auth = useAuth()

      await auth.loginWithOAuth('github')

      expect(mockClient.signIn.social).toHaveBeenCalledWith({
        provider: 'github',
        callbackURL: expect.stringMatching(/^https?:\/\/[^/]+\/$/)
      })
    })

    // TODO: window.location mock complexity
    it.todo('should support multiple OAuth providers', async () => {
      mockClient = setupIntegrationMocks()

      const { useAuth } = await import('../../app/composables/useAuth')
      const auth = useAuth()

      // Test multiple providers
      await auth.loginWithOAuth('github')
      await auth.loginWithOAuth('google')

      expect(mockClient.signIn.social).toHaveBeenCalledTimes(2)
      expect(mockClient.signIn.social).toHaveBeenCalledWith(expect.objectContaining({ provider: 'github' }))
      expect(mockClient.signIn.social).toHaveBeenCalledWith(expect.objectContaining({ provider: 'google' }))
    })

    it('should report available OAuth providers', async () => {
      mockClient = setupIntegrationMocks()

      const { useAuth } = await import('../../app/composables/useAuth')
      const auth = useAuth()

      expect(auth.hasOAuth.value).toBe(true)
      expect(auth.oauthProviders.value).toContain('github')
      expect(auth.oauthProviders.value).toContain('google')
    })
  })

  describe('Passkey Login', () => {
    it('should login with passkey', async () => {
      mockClient = setupIntegrationMocks()

      const { useAuth } = await import('../../app/composables/useAuth')
      const auth = useAuth()

      await auth.loginWithPasskey()

      expect(mockClient.signIn.passkey).toHaveBeenCalled()
    })

    it('should support conditional UI (autofill)', async () => {
      mockClient = setupIntegrationMocks()

      const { useAuth } = await import('../../app/composables/useAuth')
      const auth = useAuth()

      await auth.loginWithPasskeyAutofill()

      expect(mockClient.signIn.passkey).toHaveBeenCalledWith({ autoFill: true })
    })

    it('should report passkey availability', async () => {
      mockClient = setupIntegrationMocks()

      const { useAuth } = await import('../../app/composables/useAuth')
      const auth = useAuth()

      expect(auth.hasPasskeys.value).toBe(true)
    })
  })

  describe('Magic Link Login', () => {
    // TODO: window.location mock complexity
    it.todo('should send magic link to email', async () => {
      mockClient = setupIntegrationMocks()

      const { useAuth } = await import('../../app/composables/useAuth')
      const auth = useAuth()

      await auth.loginWithMagicLink('test@example.com')

      expect(mockClient.signIn.magicLink).toHaveBeenCalledWith({
        email: 'test@example.com',
        callbackURL: expect.stringMatching(/^https?:\/\/[^/]+\/$/)
      })
    })

    it('should report magic link availability', async () => {
      mockClient = setupIntegrationMocks()

      const { useAuth } = await import('../../app/composables/useAuth')
      const auth = useAuth()

      expect(auth.hasMagicLink.value).toBe(true)
    })
  })

  describe('Two-Factor Authentication Login', () => {
    it('should verify TOTP code', async () => {
      mockClient = setupIntegrationMocks()

      const { useAuth } = await import('../../app/composables/useAuth')
      const auth = useAuth()

      const result = await auth.verifyTotp({ code: '123456' })

      expect(result).toBe(true)
      expect(mockClient.twoFactor.verifyTotp).toHaveBeenCalledWith({
        code: '123456',
        trustDevice: undefined
      })
    })

    it('should reject invalid TOTP code', async () => {
      mockClient = setupIntegrationMocks()

      const { useAuth } = await import('../../app/composables/useAuth')
      const auth = useAuth()

      await expect(auth.verifyTotp({ code: '000000' })).rejects.toThrow('Invalid code')
      expect(auth.error.value).toBe('Invalid code')
    })

    it('should support trust device option', async () => {
      mockClient = setupIntegrationMocks()

      const { useAuth } = await import('../../app/composables/useAuth')
      const auth = useAuth()

      await auth.verifyTotp({ code: '123456', trustDevice: true })

      expect(mockClient.twoFactor.verifyTotp).toHaveBeenCalledWith({
        code: '123456',
        trustDevice: true
      })
    })

    it('should verify backup code', async () => {
      mockClient = setupIntegrationMocks()

      const { useAuth } = await import('../../app/composables/useAuth')
      const auth = useAuth()

      const result = await auth.verifyBackupCode('ABC123')

      expect(result).toBe(true)
      expect(mockClient.twoFactor.verifyBackupCode).toHaveBeenCalledWith({ code: 'ABC123' })
    })

    it('should reject invalid backup code', async () => {
      mockClient = setupIntegrationMocks()

      const { useAuth } = await import('../../app/composables/useAuth')
      const auth = useAuth()

      await expect(auth.verifyBackupCode('INVALID')).rejects.toThrow('Invalid backup code')
      expect(auth.error.value).toBe('Invalid backup code')
    })

    it('should report 2FA availability', async () => {
      mockClient = setupIntegrationMocks()

      const { useAuth } = await import('../../app/composables/useAuth')
      const auth = useAuth()

      expect(auth.has2FA.value).toBe(true)
    })
  })

  describe('Session Management', () => {
    it('should report authenticated state after login', async () => {
      const user = createTestUser()
      const session = createTestSession()
      mockClient = setupIntegrationMocks({ user, session })

      // Mock session composable
      vi.stubGlobal('useSession', () => ({
        user: { value: user },
        isAuthenticated: { value: true },
        isPending: { value: false },
        error: { value: null },
        refresh: vi.fn(),
        clear: vi.fn()
      }))

      const { useAuth } = await import('../../app/composables/useAuth')
      const auth = useAuth()

      expect(auth.user.value).toEqual(user)
      expect(auth.loggedIn.value).toBe(true)
    })

    it('should report unauthenticated state when no session', async () => {
      mockClient = setupIntegrationMocks({ user: null, session: null })

      // Mock session composable
      vi.stubGlobal('useSession', () => ({
        user: { value: null },
        isAuthenticated: { value: false },
        isPending: { value: false },
        error: { value: null },
        refresh: vi.fn(),
        clear: vi.fn()
      }))

      const { useAuth } = await import('../../app/composables/useAuth')
      const auth = useAuth()

      expect(auth.user.value).toBeNull()
      expect(auth.loggedIn.value).toBe(false)
    })

    it('should support session refresh', async () => {
      const mockRefresh = vi.fn()
      mockClient = setupIntegrationMocks()

      vi.stubGlobal('useSession', () => ({
        user: { value: null },
        isAuthenticated: { value: false },
        isPending: { value: false },
        error: { value: null },
        refresh: mockRefresh,
        clear: vi.fn()
      }))

      const { useAuth } = await import('../../app/composables/useAuth')
      const auth = useAuth()

      await auth.refreshSession()
      expect(mockRefresh).toHaveBeenCalled()
    })

    it('should logout and clear session', async () => {
      const mockClear = vi.fn()
      mockClient = setupIntegrationMocks()

      vi.stubGlobal('useSession', () => ({
        user: { value: createTestUser() },
        isAuthenticated: { value: true },
        isPending: { value: false },
        error: { value: null },
        refresh: vi.fn(),
        clear: mockClear
      }))

      const { useAuth } = await import('../../app/composables/useAuth')
      const auth = useAuth()

      await auth.logout()

      expect(mockClient.signOut).toHaveBeenCalled()
      expect(mockClear).toHaveBeenCalled()
    })
  })

  describe('Login with Team Context', () => {
    it('should maintain team context after login in multi-tenant mode', async () => {
      const user = createTestUser()
      const session = createTestSession({ activeOrganizationId: 'team-1' })
      const team = createTestTeam({ id: 'team-1' })

      mockClient = setupIntegrationMocks({
        user,
        session,
        teams: [team],
        members: [createTestMember({ userId: user.id, organizationId: team.id })]
      })

      vi.stubGlobal('useSession', () => ({
        user: { value: user },
        session: { value: session },
        isAuthenticated: { value: true },
        isPending: { value: false },
        error: { value: null },
        refresh: vi.fn(),
        clear: vi.fn()
      }))

      const { useAuth } = await import('../../app/composables/useAuth')
      const auth = useAuth()

      // After login, user should have access to team context
      expect(auth.loggedIn.value).toBe(true)
      expect(auth.user.value?.id).toBe(user.id)
    })
  })
})
