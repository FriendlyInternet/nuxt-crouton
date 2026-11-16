import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { ref } from 'vue'

// State store for useState mock
const stateStore: Record<string, any> = {}

// Mock toast
const mockToastAdd = vi.fn()

// Mock network state
let mockIsOnline = ref(true)

// Mock user session
let mockUserValue: any = ref({ id: '1', email: 'test@example.com' })

// Set up global mocks
vi.stubGlobal('ref', ref)

vi.stubGlobal('useState', (key: string, init: () => any) => {
  if (!stateStore[key]) {
    stateStore[key] = ref(init())
  }
  return stateStore[key]
})

vi.stubGlobal('useToast', () => ({
  add: mockToastAdd
}))

// Mock useT — translation keys used by useCroutonError
const translations: Record<string, string> = {
  'errors.checkConnection': 'Check your connection status.',
  'errors.notLoggedIn': 'You are not logged in.',
}
// useCroutonError translates via the app-wide $i18n (works outside setup), not useT()
vi.stubGlobal('useNuxtApp', () => ({ $i18n: { t: (key: string) => translations[key] || key } }))

// Mock useNotify — delegates to mockToastAdd
vi.stubGlobal('useNotify', () => ({
  success: (title: string, options?: any) => mockToastAdd({ title, description: options?.description, color: 'success' }),
  info: (title: string, options?: any) => mockToastAdd({ title, description: options?.description, color: 'primary' }),
  warning: (title: string, options?: any) => mockToastAdd({ title, description: options?.description, color: 'warning' }),
  error: (title: string, options?: any) => mockToastAdd({ title, description: options?.description, color: 'error' }),
}))

vi.stubGlobal('useNetwork', () => ({
  isOnline: mockIsOnline
}))

vi.stubGlobal('useSession', () => ({
  user: mockUserValue
}))

// Mock promiseTimeout from VueUse
vi.mock('@vueuse/core', () => ({
  promiseTimeout: vi.fn(() => Promise.resolve())
}))

// Import after mocking
import useCroutonError from '../useCroutonError'

describe('useCroutonError', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    // Clear state store
    Object.keys(stateStore).forEach(key => delete stateStore[key])
    // Reset mocks
    mockIsOnline = ref(true)
    mockUserValue = ref({ id: '1', email: 'test@example.com' })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('initialization', () => {
    it('returns expected properties', () => {
      const error = useCroutonError()

      expect(error.foundErrors).toBeDefined()
      expect(typeof error.foundErrors).toBe('function')
      expect(error.activeToast).toBeDefined()
      expect(error.toastVibration).toBeDefined()
    })

    it('initializes activeToast as false', () => {
      const { activeToast } = useCroutonError()

      expect(activeToast.value).toBe(false)
    })

    it('initializes toastVibration as false', () => {
      const { toastVibration } = useCroutonError()

      expect(toastVibration.value).toBe(false)
    })
  })

  describe('foundErrors()', () => {
    it('returns false when online and logged in', () => {
      mockIsOnline = ref(true)
      mockUserValue = ref({ id: '1', email: 'test@example.com' })

      const { foundErrors } = useCroutonError()

      expect(foundErrors()).toBe(false)
    })

    it('returns true when offline', () => {
      mockIsOnline = ref(false)

      const { foundErrors } = useCroutonError()

      expect(foundErrors()).toBe(true)
    })

    it('shows error toast when offline', () => {
      mockIsOnline = ref(false)

      const { foundErrors, activeToast } = useCroutonError()
      foundErrors()

      expect(mockToastAdd).toHaveBeenCalledWith({
        title: 'Check your connection status.',
        description: undefined,
        color: 'error'
      })
      expect(activeToast.value).toBe(true)
    })

    it('returns true when not logged in', () => {
      mockIsOnline = ref(true)
      mockUserValue = ref(null)

      const { foundErrors } = useCroutonError()

      expect(foundErrors()).toBe(true)
    })

    it('shows error toast when not logged in', () => {
      mockIsOnline = ref(true)
      mockUserValue = ref(null)

      const { foundErrors, activeToast } = useCroutonError()
      foundErrors()

      expect(mockToastAdd).toHaveBeenCalledWith({
        title: 'You are not logged in.',
        description: undefined,
        color: 'error'
      })
      expect(activeToast.value).toBe(true)
    })

    it('prioritizes offline check over login check', () => {
      mockIsOnline = ref(false)
      mockUserValue = ref(null)

      const { foundErrors } = useCroutonError()
      foundErrors()

      expect(mockToastAdd).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Check your connection status.'
        })
      )
      expect(mockToastAdd).toHaveBeenCalledTimes(1)
    })
  })

  describe('activeToast state', () => {
    it('is set to true after error', () => {
      mockIsOnline = ref(false)

      const { foundErrors, activeToast } = useCroutonError()
      foundErrors()

      expect(activeToast.value).toBe(true)
    })

    it('prevents duplicate toasts when already active', async () => {
      mockIsOnline = ref(false)

      const { foundErrors, activeToast } = useCroutonError()

      // First error
      foundErrors()
      expect(mockToastAdd).toHaveBeenCalledTimes(1)
      expect(activeToast.value).toBe(true)

      // Second error - should not add another toast
      foundErrors()
      expect(mockToastAdd).toHaveBeenCalledTimes(1) // Still 1
    })
  })

  describe('toastVibration state', () => {
    it('is set to false after error message', () => {
      mockIsOnline = ref(false)

      const { foundErrors, toastVibration } = useCroutonError()
      foundErrors()

      expect(toastVibration.value).toBe(false)
    })
  })

  describe('state sharing', () => {
    it('shares state between multiple calls', () => {
      mockIsOnline = ref(false)

      const error1 = useCroutonError()
      error1.foundErrors()

      const error2 = useCroutonError()

      expect(error2.activeToast.value).toBe(true)
    })
  })

  describe('edge cases', () => {
    it('handles undefined user', () => {
      mockIsOnline = ref(true)
      mockUserValue = { value: undefined } as any

      const { foundErrors } = useCroutonError()

      expect(foundErrors()).toBe(true)
    })

    it('handles missing user object', () => {
      mockIsOnline = ref(true)

      // Mock useSession to return undefined user
      vi.stubGlobal('useSession', () => ({
        user: undefined
      }))

      const { foundErrors } = useCroutonError()

      expect(foundErrors()).toBe(true)
    })
  })
})
