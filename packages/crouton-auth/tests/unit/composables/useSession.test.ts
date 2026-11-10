import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { ref, computed } from 'vue'

// Import after mocks
import { useSession } from '../../../app/composables/useSession'

// Mock auth client
const mockAuthClient = {
  getSession: vi.fn(),
  signOut: vi.fn(),
  organization: {
    getFullOrganization: vi.fn()
  },
  $store: {
    listen: vi.fn()
  }
}

// Mock useState values
const mockUseStateValues: Record<string, ReturnType<typeof ref>> = {}

// Setup global mocks
vi.stubGlobal('useNuxtApp', () => ({
  $authClient: mockAuthClient
}))

vi.stubGlobal('useAuthClientSafe', () => mockAuthClient)

vi.stubGlobal('useRuntimeConfig', () => ({
  public: {
    crouton: {
      auth: {
        debug: false
      }
    }
  }
}))

vi.stubGlobal('useRequestHeaders', () => ({}))

vi.stubGlobal('useState', (key: string, init?: () => unknown) => {
  if (!mockUseStateValues[key]) {
    mockUseStateValues[key] = ref(init ? init() : null)
  }
  return mockUseStateValues[key]
})

vi.stubGlobal('callOnce', vi.fn())

vi.stubGlobal('ref', ref)
vi.stubGlobal('computed', computed)

// Mock import.meta.client and import.meta.server
Object.defineProperty(import.meta, 'client', {
  value: false,
  writable: true,
  configurable: true
})

Object.defineProperty(import.meta, 'server', {
  value: false,
  writable: true,
  configurable: true
})

describe('useSession', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Clear useState values
    Object.keys(mockUseStateValues).forEach(key => {
      delete mockUseStateValues[key]
    })
  })

  afterEach(() => {
    vi.resetAllMocks()
  })

  describe('initial state', () => {
    it('should return null user when no session', () => {
      const { user, isAuthenticated, isPending } = useSession()
      expect(user.value).toBeNull()
      expect(isAuthenticated.value).toBe(false)
      expect(isPending.value).toBe(true)
    })

    it('should expose session, user, and activeOrganization as null initially', () => {
      const { session, user, activeOrganization } = useSession()
      expect(session.value).toBeNull()
      expect(user.value).toBeNull()
      expect(activeOrganization.value).toBeNull()
    })

    it('should expose error as null initially', () => {
      const { error } = useSession()
      expect(error.value).toBeNull()
    })
  })

  describe('session mapping', () => {
    it('should map session data correctly', () => {
      // Pre-populate the useState with session data
      mockUseStateValues['crouton-auth-session'] = ref({
        id: 'session-1',
        token: 'token-123',
        userId: 'user-1',
        expiresAt: '2025-01-01T00:00:00.000Z',
        ipAddress: '127.0.0.1',
        userAgent: 'test-agent',
        activeOrganizationId: 'org-1',
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-01T00:00:00.000Z'
      })

      const { session } = useSession()
      expect(session.value).toMatchObject({
        id: 'session-1',
        token: 'token-123',
        userId: 'user-1',
        activeOrganizationId: 'org-1'
      })
      expect(session.value?.expiresAt).toBeInstanceOf(Date)
    })
  })

  describe('user mapping', () => {
    it('should map user data correctly', () => {
      mockUseStateValues['crouton-auth-user'] = ref({
        id: 'user-1',
        email: 'test@example.com',
        name: 'Test User',
        image: 'https://example.com/avatar.jpg',
        emailVerified: true,
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-01T00:00:00.000Z'
      })
      mockUseStateValues['crouton-auth-pending'] = ref(false)

      const { user, isAuthenticated } = useSession()
      expect(user.value).toMatchObject({
        id: 'user-1',
        email: 'test@example.com',
        name: 'Test User',
        image: 'https://example.com/avatar.jpg',
        emailVerified: true
      })
      expect(isAuthenticated.value).toBe(true)
    })

    it('should handle missing optional user fields', () => {
      mockUseStateValues['crouton-auth-user'] = ref({
        id: 'user-1',
        email: 'test@example.com',
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-01T00:00:00.000Z'
      })

      const { user } = useSession()
      expect(user.value?.name).toBeNull()
      expect(user.value?.image).toBeNull()
      expect(user.value?.emailVerified).toBe(false)
    })

    it('carries role and superAdmin through to the session user', () => {
      mockUseStateValues['crouton-auth-user'] = ref({
        id: 'user-1',
        email: 'test@example.com',
        role: 'admin',
        superAdmin: true,
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-01T00:00:00.000Z'
      })

      const { user } = useSession()
      expect(user.value?.role).toBe('admin')
      expect(user.value?.superAdmin).toBe(true)
    })
  })

  describe('organization mapping', () => {
    it('should map organization data correctly', () => {
      mockUseStateValues['crouton-auth-active-org'] = ref({
        id: 'org-1',
        name: 'Test Org',
        slug: 'test-org',
        logo: 'https://example.com/logo.png',
        metadata: { key: 'value' },
        personal: false,
        isDefault: true,
        ownerId: 'user-1',
        createdAt: '2024-01-01T00:00:00.000Z'
      })

      const { activeOrganization } = useSession()
      expect(activeOrganization.value).toMatchObject({
        id: 'org-1',
        name: 'Test Org',
        slug: 'test-org',
        personal: false,
        isDefault: true
      })
    })

    it('should handle SQLite boolean format (0/1)', () => {
      mockUseStateValues['crouton-auth-active-org'] = ref({
        id: 'org-1',
        name: 'Personal Org',
        slug: 'personal',
        personal: 1, // SQLite format
        isDefault: 0,
        createdAt: '2024-01-01T00:00:00.000Z'
      })

      const { activeOrganization } = useSession()
      expect(activeOrganization.value?.personal).toBe(true)
      expect(activeOrganization.value?.isDefault).toBe(false)
    })

    it('should parse metadata JSON string', () => {
      mockUseStateValues['crouton-auth-active-org'] = ref({
        id: 'org-1',
        name: 'Test Org',
        slug: 'test-org',
        metadata: '{"custom":"data"}',
        createdAt: '2024-01-01T00:00:00.000Z'
      })

      const { activeOrganization } = useSession()
      expect(activeOrganization.value?.metadata).toEqual({ custom: 'data' })
    })

    it('should handle invalid metadata JSON gracefully', () => {
      mockUseStateValues['crouton-auth-active-org'] = ref({
        id: 'org-1',
        name: 'Test Org',
        slug: 'test-org',
        metadata: 'not-valid-json',
        createdAt: '2024-01-01T00:00:00.000Z'
      })

      const { activeOrganization } = useSession()
      expect(activeOrganization.value?.metadata).toEqual({})
    })
  })

  describe('refresh', () => {
    it('should call getSession and getFullOrganization', async () => {
      mockAuthClient.getSession.mockResolvedValue({
        data: {
          session: { id: 'session-1', userId: 'user-1' },
          user: { id: 'user-1', email: 'test@example.com' }
        },
        error: null
      })
      mockAuthClient.organization.getFullOrganization.mockResolvedValue({
        data: { id: 'org-1', name: 'Test Org', slug: 'test-org' },
        error: null
      })

      const { refresh } = useSession()
      await refresh()

      expect(mockAuthClient.getSession).toHaveBeenCalled()
      expect(mockAuthClient.organization.getFullOrganization).toHaveBeenCalled()
    })

    it('should handle session fetch error', async () => {
      mockAuthClient.getSession.mockResolvedValue({
        data: null,
        error: { message: 'Session expired' }
      })

      const { refresh, error, user } = useSession()
      await refresh()

      expect(error.value).toBeInstanceOf(Error)
      expect(error.value?.message).toBe('Session expired')
      expect(user.value).toBeNull()
    })
  })

  describe('clear', () => {
    it('should sign out and clear state', async () => {
      mockAuthClient.signOut.mockResolvedValue({})

      // Pre-populate with session data
      mockUseStateValues['crouton-auth-session'] = ref({ id: 'session-1' })
      mockUseStateValues['crouton-auth-user'] = ref({ id: 'user-1' })
      mockUseStateValues['crouton-auth-active-org'] = ref({ id: 'org-1' })

      const { clear, session, user, activeOrganization } = useSession()
      await clear()

      expect(mockAuthClient.signOut).toHaveBeenCalled()
      expect(session.value).toBeNull()
      expect(user.value).toBeNull()
      expect(activeOrganization.value).toBeNull()
    })
  })

  describe('sessionData (backward compatibility)', () => {
    it('should return combined session data', () => {
      mockUseStateValues['crouton-auth-session'] = ref({ id: 'session-1' })
      mockUseStateValues['crouton-auth-user'] = ref({ id: 'user-1' })

      const { data } = useSession()
      expect(data.value).toEqual({
        session: { id: 'session-1' },
        user: { id: 'user-1' }
      })
    })

    it('should return null when no session or user', () => {
      const { data } = useSession()
      expect(data.value).toBeNull()
    })
  })
})
