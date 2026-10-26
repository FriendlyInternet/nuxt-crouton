import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { ref, computed, readonly } from 'vue'

// Import after mocks
import { useScopedAccess, useEventAccess, useBookingAccess } from '../../../app/composables/useScopedAccess'

// Mock localStorage
const mockLocalStorage: Record<string, string> = {}
const localStorageMock = {
  getItem: (key: string) => mockLocalStorage[key] || null,
  setItem: (key: string, value: string) => { mockLocalStorage[key] = value },
  removeItem: (key: string) => { delete mockLocalStorage[key] },
  clear: () => { Object.keys(mockLocalStorage).forEach(key => delete mockLocalStorage[key]) }
}
Object.defineProperty(global, 'localStorage', { value: localStorageMock })

// Mock cookies — keyed by name so storage-key behavior is actually exercised;
// last write options per name are recorded so maxAge can be asserted.
const mockCookies: Record<string, unknown> = {}
const mockCookieWriteOptions: Record<string, Record<string, unknown> | undefined> = {}

// Mock $fetch
const mock$Fetch = vi.fn()

// Mock useState values
const mockUseStateValues: Record<string, ReturnType<typeof ref>> = {}

// Setup global mocks
vi.stubGlobal('ref', ref)
vi.stubGlobal('computed', computed)
vi.stubGlobal('readonly', readonly)
vi.stubGlobal('$fetch', mock$Fetch)

vi.stubGlobal('useState', (key: string, init?: () => unknown) => {
  if (!mockUseStateValues[key]) {
    mockUseStateValues[key] = ref(init ? init() : null)
  }
  return mockUseStateValues[key]
})

vi.stubGlobal('useCookie', (name: string, opts?: Record<string, unknown>) => ({
  get value() {
    const v = mockCookies[name]
    if (v === undefined && typeof opts?.default === 'function') return (opts.default as () => unknown)()
    return v ?? null
  },
  set value(v: unknown) {
    mockCookies[name] = v
    mockCookieWriteOptions[name] = opts
  }
}))

function clearMockCookies() {
  Object.keys(mockCookies).forEach(key => delete mockCookies[key])
  Object.keys(mockCookieWriteOptions).forEach(key => delete mockCookieWriteOptions[key])
}

// Mock import.meta.client
Object.defineProperty(import.meta, 'client', {
  value: true,
  writable: true,
  configurable: true
})

describe('useScopedAccess', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorageMock.clear()
    clearMockCookies()
    Object.keys(mockUseStateValues).forEach(key => delete mockUseStateValues[key])
  })

  afterEach(() => {
    vi.resetAllMocks()
  })

  describe('initial state', () => {
    it('should have null session initially', () => {
      const { session, isAuthenticated } = useScopedAccess('event')
      expect(session.value).toBeNull()
      expect(isAuthenticated.value).toBe(false)
    })

    it('should have empty computed values initially', () => {
      const { token, displayName, organizationId, resourceId, role, expiresAt } = useScopedAccess('event')
      expect(token.value).toBe('')
      expect(displayName.value).toBe('')
      expect(organizationId.value).toBe('')
      expect(resourceId.value).toBe('')
      expect(role.value).toBe('')
      expect(expiresAt.value).toBeNull()
    })

    it('should have loading and error states', () => {
      const { isLoading, error } = useScopedAccess('event')
      expect(isLoading.value).toBe(false)
      expect(error.value).toBeNull()
    })
  })

  describe('loadSession', () => {
    const validSession = (overrides: Record<string, unknown> = {}) => ({
      token: 'test-token',
      displayName: 'Test User',
      organizationId: 'org-1',
      resourceType: 'event',
      resourceId: 'event-1',
      role: 'helper',
      expiresAt: new Date(Date.now() + 3600000).toISOString(),
      ...overrides
    })

    it('should load a valid session from the per-resourceType cookie', () => {
      mockCookies['scoped-access-session-event'] = validSession()

      const { loadSession, session, isAuthenticated } = useScopedAccess('event')
      const result = loadSession()

      expect(result?.token).toBe('test-token')
      expect(session.value?.resourceId).toBe('event-1')
      expect(isAuthenticated.value).toBe(true)
    })

    it('should return null and clear cookie for expired session', () => {
      mockCookies['scoped-access-session-event'] = validSession({
        expiresAt: new Date(Date.now() - 3600000).toISOString()
      })

      const { loadSession, session } = useScopedAccess('event')
      const result = loadSession()

      expect(result).toBeNull()
      expect(session.value).toBeNull()
      expect(mockCookies['scoped-access-session-event']).toBeNull()
    })

    it('should return null for different resource type', () => {
      mockCookies['scoped-access-session-event'] = validSession({
        resourceType: 'booking',
        resourceId: 'booking-1',
        role: 'guest'
      })

      const { loadSession } = useScopedAccess('event')
      const result = loadSession()

      expect(result).toBeNull()
    })

    it('should not see sessions stored for another resource type key', () => {
      mockCookies['scoped-access-session-booking'] = validSession({
        resourceType: 'booking',
        resourceId: 'booking-1'
      })

      const { loadSession } = useScopedAccess('event')
      expect(loadSession()).toBeNull()
    })
  })

  describe('saveSession (via login)', () => {
    it('should persist the session cookie with maxAge derived from expiresAt', async () => {
      const expiresAt = new Date(Date.now() + 2 * 3600000).toISOString() // 2h, not the 8h default
      mock$Fetch.mockResolvedValue({
        token: 'new-token',
        displayName: 'New User',
        organizationId: 'org-1',
        resourceId: 'event-1',
        role: 'helper',
        expiresAt
      })

      const { login } = useScopedAccess('event')
      await login({ loginEndpoint: '/api/auth/scoped-access/redeem', body: {} })

      const stored = mockCookies['scoped-access-session-event'] as { token: string }
      expect(stored.token).toBe('new-token')

      const maxAge = mockCookieWriteOptions['scoped-access-session-event']?.maxAge as number
      expect(maxAge).toBeGreaterThan(2 * 3600 - 60)
      expect(maxAge).toBeLessThanOrEqual(2 * 3600)

      // Token cookie mirrors the same lifetime
      expect(mockCookies['scoped-access-token']).toBe('new-token')
      expect(mockCookieWriteOptions['scoped-access-token']?.maxAge).toBe(maxAge)
    })
  })

  describe('login', () => {
    it('should login successfully and save session', async () => {
      const futureDate = new Date(Date.now() + 3600000).toISOString()
      mock$Fetch.mockResolvedValue({
        token: 'new-token',
        displayName: 'New User',
        organizationId: 'org-1',
        resourceId: 'event-1',
        role: 'helper',
        expiresAt: futureDate
      })

      const { login, session, isAuthenticated } = useScopedAccess('event')
      const result = await login({
        loginEndpoint: '/api/auth/helper/login',
        body: { pin: '1234', resourceId: 'event-1' }
      })

      expect(result).toBe(true)
      expect(mock$Fetch).toHaveBeenCalledWith('/api/auth/helper/login', {
        method: 'POST',
        body: { pin: '1234', resourceId: 'event-1' }
      })
      expect(session.value?.token).toBe('new-token')
      expect(isAuthenticated.value).toBe(true)
    })

    it('should handle legacy field names', async () => {
      const futureDate = new Date(Date.now() + 3600000).toISOString()
      mock$Fetch.mockResolvedValue({
        token: 'new-token',
        helperName: 'Legacy User', // Legacy field
        teamId: 'team-1',         // Legacy field
        eventId: 'event-1',        // Legacy field
        expiresAt: futureDate
      })

      const { login, displayName, organizationId, resourceId } = useScopedAccess('event')
      await login({
        loginEndpoint: '/api/auth/helper/login',
        body: { pin: '1234' }
      })

      expect(displayName.value).toBe('Legacy User')
      expect(organizationId.value).toBe('team-1')
      expect(resourceId.value).toBe('event-1')
    })

    it('should handle login failure', async () => {
      mock$Fetch.mockRejectedValue({
        data: { message: 'Invalid PIN' }
      })

      const { login, error, isAuthenticated } = useScopedAccess('event')
      const result = await login({
        loginEndpoint: '/api/auth/helper/login',
        body: { pin: 'wrong' }
      })

      expect(result).toBe(false)
      expect(error.value).toBe('Invalid PIN')
      expect(isAuthenticated.value).toBe(false)
    })

    it('should expose the HTTP status of a failed login', async () => {
      mock$Fetch.mockRejectedValue({
        status: 429,
        data: { statusMessage: 'Too many attempts — try again later' }
      })

      const { login, errorStatus } = useScopedAccess('event')
      const result = await login({
        loginEndpoint: '/api/auth/scoped-access/redeem',
        body: { secret: 'wrong' }
      })

      expect(result).toBe(false)
      expect(errorStatus.value).toBe(429)
    })

    it('should set loading state during login', async () => {
      mock$Fetch.mockImplementation(() => new Promise(resolve =>
        setTimeout(() => resolve({ token: 'token', expiresAt: new Date().toISOString() }), 100)
      ))

      const { login, isLoading } = useScopedAccess('event')
      const loginPromise = login({
        loginEndpoint: '/api/auth/helper/login',
        body: { pin: '1234' }
      })

      expect(isLoading.value).toBe(true)
      await loginPromise
      expect(isLoading.value).toBe(false)
    })
  })

  describe('redeem', () => {
    it('should post to the generic redeem endpoint with resourceType injected', async () => {
      const futureDate = new Date(Date.now() + 3600000).toISOString()
      mock$Fetch.mockResolvedValue({
        token: 'redeemed-token',
        displayName: 'Volunteer',
        teamId: 'team-1',
        resourceType: 'event',
        resourceId: 'event-1',
        role: 'helper',
        expiresAt: futureDate
      })

      const { redeem, session } = useScopedAccess('event')
      const result = await redeem({
        teamId: 'team-1',
        resourceId: 'event-1',
        secret: '1234',
        displayName: 'Volunteer'
      })

      expect(result).toBe(true)
      expect(mock$Fetch).toHaveBeenCalledWith('/api/auth/scoped-access/redeem', {
        method: 'POST',
        body: {
          teamId: 'team-1',
          resourceId: 'event-1',
          secret: '1234',
          displayName: 'Volunteer',
          resourceType: 'event'
        }
      })
      expect(session.value?.token).toBe('redeemed-token')
      expect(session.value?.organizationId).toBe('team-1')
    })
  })

  describe('logout', () => {
    it('should clear session and notify server', async () => {
      // Pre-populate session
      const futureDate = new Date(Date.now() + 3600000).toISOString()
      mockUseStateValues['scoped-access-event'] = ref({
        token: 'test-token',
        displayName: 'Test',
        organizationId: 'org-1',
        resourceType: 'event',
        resourceId: 'event-1',
        role: 'helper',
        expiresAt: futureDate
      })

      mock$Fetch.mockResolvedValue({})

      const { logout, session } = useScopedAccess('event')
      await logout()

      expect(session.value).toBeNull()
      expect(mock$Fetch).toHaveBeenCalledWith('/api/auth/scoped-access/logout', {
        method: 'POST',
        body: { token: 'test-token' }
      })
    })
  })

  describe('clearSession', () => {
    // TODO: import.meta.client cannot be properly mocked after module import
    // This test requires Vitest's vi.stubEnv or a different mocking approach
    it.todo('should clear session state and localStorage')
  })

  describe('validateSession', () => {
    it('should return true for valid session', async () => {
      mockUseStateValues['scoped-access-event'] = ref({ token: 'valid-token' })
      mock$Fetch.mockResolvedValue({ valid: true })

      const { validateSession } = useScopedAccess('event')
      const result = await validateSession()

      expect(result).toBe(true)
      expect(mock$Fetch).toHaveBeenCalledWith('/api/auth/scoped-access/validate', {
        method: 'POST',
        body: { token: 'valid-token' }
      })
    })

    it('should return false and clear session for invalid token', async () => {
      mockUseStateValues['scoped-access-event'] = ref({ token: 'invalid-token' })
      mock$Fetch.mockRejectedValue(new Error('Invalid'))

      const { validateSession, session } = useScopedAccess('event')
      const result = await validateSession()

      expect(result).toBe(false)
      expect(session.value).toBeNull()
    })

    it('should return false when no session', async () => {
      const { validateSession } = useScopedAccess('event')
      const result = await validateSession()

      expect(result).toBe(false)
      expect(mock$Fetch).not.toHaveBeenCalled()
    })
  })

  describe('refreshSession', () => {
    it('should refresh session expiration', async () => {
      const futureDate = new Date(Date.now() + 3600000).toISOString()
      mockUseStateValues['scoped-access-event'] = ref({
        token: 'test-token',
        displayName: 'Test',
        organizationId: 'org-1',
        resourceType: 'event',
        resourceId: 'event-1',
        role: 'helper',
        expiresAt: futureDate
      })

      const newExpiry = new Date(Date.now() + 7200000).toISOString()
      mock$Fetch.mockResolvedValue({ expiresAt: newExpiry })

      const { refreshSession, session } = useScopedAccess('event')
      const result = await refreshSession(8)

      expect(result).toBe(true)
      expect(session.value?.expiresAt).toBe(newExpiry)
    })

    it('should return false when no session', async () => {
      const { refreshSession } = useScopedAccess('event')
      const result = await refreshSession()

      expect(result).toBe(false)
      expect(mock$Fetch).not.toHaveBeenCalled()
    })
  })

  describe('isAuthenticated', () => {
    it('should return false for expired session', () => {
      const pastDate = new Date(Date.now() - 3600000).toISOString()
      mockUseStateValues['scoped-access-event'] = ref({
        token: 'test-token',
        displayName: 'Test',
        organizationId: 'org-1',
        resourceType: 'event',
        resourceId: 'event-1',
        role: 'helper',
        expiresAt: pastDate
      })

      const { isAuthenticated } = useScopedAccess('event')
      expect(isAuthenticated.value).toBe(false)
    })
  })
})

describe('useEventAccess', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorageMock.clear()
    clearMockCookies()
    Object.keys(mockUseStateValues).forEach(key => delete mockUseStateValues[key])
  })

  it('should use event-specific defaults', () => {
    const access = useEventAccess()
    expect(access.session.value).toBeNull()
  })
})

describe('useBookingAccess', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorageMock.clear()
    clearMockCookies()
    Object.keys(mockUseStateValues).forEach(key => delete mockUseStateValues[key])
  })

  it('should use booking-specific defaults', () => {
    const access = useBookingAccess()
    expect(access.session.value).toBeNull()
  })
})
