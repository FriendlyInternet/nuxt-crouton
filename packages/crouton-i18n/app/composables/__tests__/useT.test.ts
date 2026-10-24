import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { ref, computed, watch } from 'vue'

// State holders for useState mock
const stateStore: Record<string, any> = {}

// Mock $fetch
const mockFetch = vi.fn()

// Mock i18n t function
const mockI18nT = vi.fn((key: string) => key)

// Mock locale
let mockLocale = ref('en')

// Mock team slug
let mockTeamSlug = ref<string | null>('test-team')

// Set up all global mocks
vi.stubGlobal('ref', ref)
vi.stubGlobal('computed', computed)
vi.stubGlobal('watch', watch)

vi.stubGlobal('useI18n', () => ({
  locale: mockLocale,
  t: mockI18nT,
  locales: ref([
    { code: 'en' },
    { code: 'nl' },
    { code: 'fr' }
  ])
}))

vi.stubGlobal('useTeamContext', () => ({
  teamSlug: mockTeamSlug
}))

vi.stubGlobal('useState', (key: string, init: () => any) => {
  if (!stateStore[key]) {
    stateStore[key] = ref(init())
  }
  return stateStore[key]
})

vi.stubGlobal('$fetch', mockFetch)

// Note: import.meta.client, import.meta.server, and import.meta.dev
// are defined in vitest.config.ts via the `define` option

// Import composable after mocking
import { useT } from '../useT'

describe('useT', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Reset state store
    Object.keys(stateStore).forEach(key => delete stateStore[key])
    // Reset mocks
    mockLocale = ref('en')
    mockTeamSlug = ref('test-team')
    mockFetch.mockReset()
    mockI18nT.mockImplementation((key: string) => key)
  })

  describe('initialization', () => {
    it('returns required functions and values', () => {
      const result = useT()

      expect(result).toHaveProperty('t')
      expect(result).toHaveProperty('tString')
      expect(result).toHaveProperty('tContent')
      expect(result).toHaveProperty('tInfo')
      expect(result).toHaveProperty('hasTranslation')
      expect(result).toHaveProperty('getAvailableLocales')
      expect(result).toHaveProperty('getTranslationMeta')
      expect(result).toHaveProperty('refreshTranslations')
      expect(result).toHaveProperty('locale')
      expect(result).toHaveProperty('isDev')
      expect(result).toHaveProperty('devModeEnabled')
    })

    it('exposes reactive locale from i18n', () => {
      const { locale } = useT()

      expect(locale.value).toBe('en')
    })
  })

  describe('t() - basic translation', () => {
    it('returns translation from i18n when no team override exists', () => {
      mockI18nT.mockImplementation((key: string) => {
        if (key === 'common.save') return 'Save'
        return key
      })

      const { t } = useT()
      const result = t('common.save')

      expect(result).toBe('Save')
    })

    it('returns [key] when translation is missing', () => {
      mockI18nT.mockImplementation((key: string) => key) // Returns key = not found

      const { t } = useT()
      const result = t('missing.key')

      expect(result).toBe('[missing.key]')
    })

    it('returns fallback when translation is missing and fallback provided', () => {
      mockI18nT.mockImplementation((key: string) => key)

      const { t } = useT()
      const result = t('missing.key', { fallback: 'Default Value' })

      expect(result).toBe('Default Value')
    })

    it('returns placeholder when translation is missing and placeholder provided', () => {
      mockI18nT.mockImplementation((key: string) => key)

      const { t } = useT()
      const result = t('missing.key', { placeholder: 'Loading...' })

      expect(result).toBe('Loading...')
    })

    it('prefers fallback over placeholder', () => {
      mockI18nT.mockImplementation((key: string) => key)

      const { t } = useT()
      const result = t('missing.key', { fallback: 'Fallback', placeholder: 'Placeholder' })

      expect(result).toBe('Fallback')
    })
  })

  describe('t() - parameter substitution', () => {
    it('substitutes parameters in translation', () => {
      mockI18nT.mockImplementation((key: string) => {
        if (key === 'greeting') return 'Hello {name}'
        return key
      })

      const { t } = useT()
      const result = t('greeting', { params: { name: 'Alice' } })

      expect(result).toBe('Hello Alice')
    })

    it('substitutes multiple parameters', () => {
      mockI18nT.mockImplementation((key: string) => {
        if (key === 'welcome') return 'Welcome {user} to {place}'
        return key
      })

      const { t } = useT()
      const result = t('welcome', { params: { user: 'Bob', place: 'Dashboard' } })

      expect(result).toBe('Welcome Bob to Dashboard')
    })

    // #1756: `||` treats 0 / false / '' as absent, so a count of zero rendered as a
    // BLANK. Reachable on the team-override path, which skips vue-i18n's own
    // interpolation and relies solely on this substitution.
    it('renders a count of 0 rather than blanking it', () => {
      mockI18nT.mockImplementation((key: string) => {
        if (key === 'items.count') return '{count} items'
        return key
      })

      const { t } = useT()

      expect(t('items.count', { params: { count: 0 } })).toBe('0 items')
    })

    it('renders a false parameter rather than blanking it', () => {
      mockI18nT.mockImplementation((key: string) => {
        if (key === 'flag.state') return 'enabled: {enabled}'
        return key
      })

      const { t } = useT()

      expect(t('flag.state', { params: { enabled: false } })).toBe('enabled: false')
    })

    it('renders zero on the TEAM-OVERRIDE path — the one that skips vue-i18n', () => {
      const { t } = useT()
      stateStore['teamTranslations'].value = { 'orders.deleted': '{count} bestelling(en) verwijderd' }
      stateStore['teamTranslationsLoaded'].value = true

      expect(t('orders.deleted', { params: { count: 0 } })).toBe('0 bestelling(en) verwijderd')
    })

    it('handles missing parameters gracefully', () => {
      mockI18nT.mockImplementation((key: string) => {
        if (key === 'greeting') return 'Hello {name}'
        return key
      })

      const { t } = useT()
      const result = t('greeting', { params: {} })

      expect(result).toBe('Hello ')
    })
  })

  describe('t() - team overrides', () => {
    it('uses team override when available', async () => {
      mockI18nT.mockImplementation((key: string) => {
        if (key === 'common.save') return 'System Save'
        return key
      })

      // Call useT first so it creates its useState instances
      const { t } = useT()

      // Then set up team translations in state (after useT creates the state)
      stateStore['teamTranslations'].value = { 'common.save': 'Team Save' }
      stateStore['teamTranslationsLoaded'].value = true

      const result = t('common.save')

      expect(result).toBe('Team Save')
    })

    it('falls back to system translation when no team override', async () => {
      mockI18nT.mockImplementation((key: string) => {
        if (key === 'common.save') return 'System Save'
        return key
      })

      // Call useT first so it creates its useState instances
      const { t } = useT()

      // Empty team translations
      stateStore['teamTranslations'].value = {}
      stateStore['teamTranslationsLoaded'].value = true

      const result = t('common.save')

      expect(result).toBe('System Save')
    })
  })

  describe('tString()', () => {
    it('returns string translation without dev mode wrapper', () => {
      mockI18nT.mockImplementation((key: string) => {
        if (key === 'common.cancel') return 'Cancel'
        return key
      })

      const { tString } = useT()
      const result = tString('common.cancel')

      expect(result).toBe('Cancel')
      expect(typeof result).toBe('string')
    })

    it('uses team override when available', () => {
      // Call useT first so it creates its useState instances
      const { tString } = useT()

      // Then set up team translations in state
      stateStore['teamTranslations'].value = { 'common.cancel': 'Team Cancel' }
      stateStore['teamTranslationsLoaded'].value = true

      const result = tString('common.cancel')

      expect(result).toBe('Team Cancel')
    })

    it('substitutes parameters', () => {
      mockI18nT.mockImplementation((key: string) => {
        if (key === 'items.count') return '{count} items'
        return key
      })

      const { tString } = useT()
      const result = tString('items.count', { params: { count: '5' } })

      expect(result).toBe('5 items')
    })

    it('returns [key] for missing translation', () => {
      mockI18nT.mockImplementation((key: string) => key)

      const { tString } = useT()
      const result = tString('missing.key')

      expect(result).toBe('[missing.key]')
    })
  })

  describe('tString() - zero-valued parameters (#1756)', () => {
    it('renders a count of 0 rather than blanking it', () => {
      const { tString } = useT()
      stateStore['teamTranslations'].value = { 'items.count': '{count} items' }
      stateStore['teamTranslationsLoaded'].value = true

      expect(tString('items.count', { params: { count: 0 } })).toBe('0 items')
    })
  })

  describe('tContent() - entity content translation', () => {
    it('returns translated field from entity', () => {
      const entity = {
        name: 'Original Name',
        translations: {
          en: { name: 'English Name' },
          nl: { name: 'Dutch Name' }
        }
      }

      const { tContent } = useT()
      const result = tContent(entity, 'name')

      expect(result).toBe('English Name')
    })

    it('respects preferred locale', () => {
      const entity = {
        name: 'Original Name',
        translations: {
          en: { name: 'English Name' },
          nl: { name: 'Dutch Name' }
        }
      }

      const { tContent } = useT()
      const result = tContent(entity, 'name', 'nl')

      expect(result).toBe('Dutch Name')
    })

    it('falls back to other locales when requested locale missing', () => {
      const entity = {
        name: 'Original Name',
        translations: {
          en: { name: 'English Name' }
        }
      }

      const { tContent } = useT()
      const result = tContent(entity, 'name', 'de') // German not available

      expect(result).toBe('English Name') // Falls back to en
    })

    it('falls back to entity field when no translations', () => {
      const entity = {
        name: 'Original Name',
        translations: {}
      }

      const { tContent } = useT()
      const result = tContent(entity, 'name')

      expect(result).toBe('Original Name')
    })

    it('returns empty string for null entity', () => {
      const { tContent } = useT()
      const result = tContent(null, 'name')

      expect(result).toBe('')
    })

    it('returns empty string for undefined entity', () => {
      const { tContent } = useT()
      const result = tContent(undefined, 'name')

      expect(result).toBe('')
    })
  })

  describe('hasTranslation()', () => {
    it('returns true when team override exists', () => {
      // Call useT first so it creates its useState instances
      const { hasTranslation } = useT()

      // Then set up team translations in state
      stateStore['teamTranslations'].value = { 'common.save': 'Save' }
      stateStore['teamTranslationsLoaded'].value = true

      const result = hasTranslation('common.save')

      expect(result).toBe(true)
    })

    it('returns true when system translation exists', () => {
      mockI18nT.mockImplementation((key: string) => {
        if (key === 'common.save') return 'Save'
        return key
      })

      // Call useT first so it creates its useState instances
      const { hasTranslation } = useT()

      // Empty team translations
      stateStore['teamTranslations'].value = {}
      stateStore['teamTranslationsLoaded'].value = true

      const result = hasTranslation('common.save')

      expect(result).toBe(true)
    })

    it('returns false when translation is missing', () => {
      mockI18nT.mockImplementation((key: string) => key) // Returns key = not found

      // Call useT first so it creates its useState instances
      const { hasTranslation } = useT()

      // Empty team translations
      stateStore['teamTranslations'].value = {}
      stateStore['teamTranslationsLoaded'].value = true

      const result = hasTranslation('missing.key')

      expect(result).toBe(false)
    })
  })

  describe('getTranslationInfo()', () => {
    it('returns translation info with key and value', () => {
      mockI18nT.mockImplementation((key: string) => {
        if (key === 'common.save') return 'Save'
        return key
      })

      const { tInfo } = useT()
      const info = tInfo('common.save')

      expect(info.key).toBe('common.save')
      expect(info.value).toBe('Save')
    })

    it('indicates when translation is missing', () => {
      mockI18nT.mockImplementation((key: string) => key)

      const { tInfo } = useT()
      const info = tInfo('missing.key')

      expect(info.isMissing).toBe(true)
    })

    it('indicates when team override exists', () => {
      // Call useT first so it creates its useState instances
      const { tInfo } = useT()

      // Then set up team translations in state
      stateStore['teamTranslations'].value = { 'common.save': 'Team Save' }
      stateStore['teamTranslationsLoaded'].value = true

      const info = tInfo('common.save')

      expect(info.hasTeamOverride).toBe(true)
    })

    it('includes category from options', () => {
      const { tInfo } = useT()
      const info = tInfo('products.title', { category: 'products' })

      expect(info.category).toBe('products')
    })

    it('defaults category to ui', () => {
      const { tInfo } = useT()
      const info = tInfo('common.save')

      expect(info.category).toBe('ui')
    })
  })

  describe('getTranslationMeta()', () => {
    it('returns metadata for translation key', () => {
      mockI18nT.mockImplementation((key: string) => {
        if (key === 'common.save') return 'Save'
        return key
      })

      const { getTranslationMeta } = useT()
      const meta = getTranslationMeta('common.save')

      expect(meta.key).toBe('common.save')
      expect(meta.value).toBe('Save')
      expect(meta.hasTeamOverride).toBe(false)
      expect(meta.isSystemMissing).toBe(false)
      expect(meta.availableLocales).toContain('en')
    })

    it('indicates system missing when key not found', () => {
      mockI18nT.mockImplementation((key: string) => key)

      const { getTranslationMeta } = useT()
      const meta = getTranslationMeta('missing.key')

      expect(meta.isSystemMissing).toBe(true)
    })

    it('shows team override value when available', () => {
      mockI18nT.mockImplementation((key: string) => {
        if (key === 'common.save') return 'Save'
        return key
      })

      // Call useT first so it creates its useState instances
      const { getTranslationMeta } = useT()

      // Then set up team translations in state
      stateStore['teamTranslations'].value = { 'common.save': 'Custom Save' }
      stateStore['teamTranslationsLoaded'].value = true

      const meta = getTranslationMeta('common.save')

      expect(meta.value).toBe('Custom Save')
      expect(meta.hasTeamOverride).toBe(true)
    })
  })

  describe('getAvailableLocales()', () => {
    it('returns array of available locales', () => {
      const { getAvailableLocales } = useT()
      const locales = getAvailableLocales()

      expect(Array.isArray(locales)).toBe(true)
      expect(locales).toContain('en')
      expect(locales).toContain('nl')
      expect(locales).toContain('fr')
    })
  })

  describe('refreshTranslations()', () => {
    it('resets translations loaded state', async () => {
      stateStore['teamTranslationsLoaded'] = ref(true)
      mockFetch.mockResolvedValue([])

      const { refreshTranslations } = useT()
      await refreshTranslations()

      // Should have attempted to reload translations
      expect(mockFetch).toHaveBeenCalled()
    })
  })

  describe('team translation loading', () => {
    it('loads team translations when refreshTranslations is called', async () => {
      mockTeamSlug = ref('my-team')
      mockFetch.mockResolvedValue([
        { keyPath: 'common.save', systemValues: { en: 'Save' } }
      ])

      const { refreshTranslations } = useT()

      // Explicitly trigger loading via refreshTranslations
      await refreshTranslations()

      expect(mockFetch).toHaveBeenCalledWith(
        '/api/teams/my-team/translations-ui/with-system',
        expect.objectContaining({
          query: { locale: 'en' }
        })
      )
    })

    it('does not load team translations when no team slug', async () => {
      mockTeamSlug = ref(null)
      mockFetch.mockResolvedValue([])

      const { refreshTranslations } = useT()
      await refreshTranslations()

      // Fetch is not called because there's no team slug
      expect(mockFetch).not.toHaveBeenCalled()
    })

    it('parses team values from API response', async () => {
      mockTeamSlug = ref('my-team')
      mockFetch.mockResolvedValue([
        { keyPath: 'common.save', teamValues: { en: 'Team Save' }, systemValues: { en: 'Save' } }
      ])

      const { refreshTranslations } = useT()
      await refreshTranslations()

      expect(stateStore['teamTranslations'].value).toHaveProperty('common.save', 'Team Save')
    })

    it('uses system values when no team override', async () => {
      mockTeamSlug = ref('my-team')
      mockFetch.mockResolvedValue([
        { keyPath: 'common.save', systemValues: { en: 'System Save' } }
      ])

      const { refreshTranslations } = useT()
      await refreshTranslations()

      expect(stateStore['teamTranslations'].value).toHaveProperty('common.save', 'System Save')
    })

    it('handles API error gracefully', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      mockTeamSlug = ref('my-team')
      mockFetch.mockRejectedValue(new Error('Network error'))

      const { refreshTranslations } = useT()
      await refreshTranslations()

      expect(consoleSpy).toHaveBeenCalledWith('[useT] Failed to load team translations:', expect.any(Error))
      consoleSpy.mockRestore()
    })
  })
})
