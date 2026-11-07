import { vi } from 'vitest'
import { ref, computed, reactive } from 'vue'

/**
 * Creates mock implementations of common Nuxt composables
 * for testing purposes.
 */
export function createNuxtMocks(overrides: Record<string, any> = {}): Record<string, any> {
  return {
    useRoute: () => ({
      path: '/teams/test-team/products',
      params: { team: 'test-team' }
    }),
    useState: vi.fn((key: string, init: () => any) => ref(init())),
    useAppConfig: () => ({ croutonCollections: {} }),
    useToast: () => ({ add: vi.fn() }),
    useFetch: vi.fn(),
    $fetch: vi.fn(),
    useNuxtApp: () => ({
      payload: { data: {} },
      hooks: { callHook: vi.fn() }
    }),
    refreshNuxtData: vi.fn(),
    computed,
    ref,
    reactive,
    ...overrides
  }
}

/**
 * Creates a mock for the useT composable
 * Returns translation key as value for predictable testing
 */
export function createUseTMock() {
  const translate = (key: string): string => key
  return {
    t: translate,
    tString: translate,
    tContent: (entity: any, field: string): string => entity?.[field] || '',
    tInfo: (key: string) => ({
      key,
      value: key,
      mode: 'system' as const,
      category: 'ui',
      isMissing: false,
      hasTeamOverride: false
    }),
    hasTranslation: () => true,
    getAvailableLocales: () => ['en'],
    getTranslationMeta: (key: string) => ({
      key,
      value: key,
      hasTeamOverride: false,
      isSystemMissing: false,
      availableLocales: ['en']
    }),
    refreshTranslations: async () => {},
    locale: ref('en'),
    isDev: false,
    devModeEnabled: ref(false)
  }
}

/**
 * Sample test data for table tests
 */
export const sampleRows = [
  { id: '1', name: 'Apple', category: 'Fruit', price: 1.5, createdAt: '2024-01-01' },
  { id: '2', name: 'Banana', category: 'Fruit', price: 0.75, createdAt: '2024-01-02' },
  { id: '3', name: 'Carrot', category: 'Vegetable', price: 0.5, createdAt: '2024-01-03' },
  { id: '4', name: 'Donut', category: 'Snack', price: 2.0, createdAt: '2024-01-04' },
  { id: '5', name: 'Eggplant', category: 'Vegetable', price: 1.25, createdAt: '2024-01-05' }
]

/**
 * Creates reactive refs for pagination testing
 */
export function createPaginationRefs(overrides: {
  page?: number
  pageCount?: number
  search?: string
} = {}) {
  return {
    page: ref(overrides.page ?? 1),
    pageCount: ref(overrides.pageCount ?? 10),
    search: ref(overrides.search ?? '')
  }
}