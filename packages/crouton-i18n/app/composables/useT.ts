interface TranslationOptions {
  params?: Record<string, any>
  fallback?: string
  category?: string
  mode?: 'system' | 'team'
  placeholder?: string // What to show when translation is missing
  [key: string]: any // Allow named params as shorthand
}

// Module-level dedup (client modules are singletons per browser tab; server re-imports per request)
let _clientWatchActive = false
let _pendingLoad: Promise<void> | null = null

/**
 * Translation composable with team override support and dev mode editing
 *
 * This composable provides a translation function that:
 * 1. First checks team-specific overrides
 * 2. Falls back to system translations
 * 3. Returns the key if no translation found
 * 4. In dev mode, wraps translations with DevTranslationWrapper for inline editing
 */
export function useT() {
  // Safely get i18n - it may not be available during SSR on some routes
  let i18n: ReturnType<typeof useI18n> | null = null
  try {
    i18n = useI18n() as any
  } catch (error) {
    // i18n not available, will use fallback behavior
    if (import.meta.dev) {
      console.warn('[useT] useI18n() not available, using fallback mode')
    }
  }

  // Use computed to ensure locale stays reactive, with fallback to 'en'
  const locale = computed(() => i18n?.locale?.value ?? 'en')

  // Safely get team context - may not be available on all routes
  let teamSlug: { value: string | null } = { value: null }
  try {
    const context = useTeamContext()
    teamSlug = context.teamSlug
  } catch (error) {
    // Team context not available, that's fine for public routes
  }

  const isDev = import.meta.dev
  const devModeEnabled = useState('devMode.enabled', () => false)

  // Get team slug from useTeamContext() - handles both useTeam() and route.params.team fallback
  const teamSlugFromRoute = computed(() => teamSlug.value ?? undefined)

  // Reserved prefixes that should NOT be treated as team slugs
  const reservedPrefixes = ['auth', 'api', 'admin', 'dashboard', '_nuxt', '__nuxt']

  // Cache for team translations to avoid repeated API calls
  const teamTranslations = useState<Record<string, any>>('teamTranslations', () => ({}))
  const teamTranslationsLoaded = useState<boolean>('teamTranslationsLoaded', () => false)

  // Load team translations if not already loaded (deduped — concurrent calls share one fetch)
  const loadTeamTranslations = async () => {
    if (!teamSlugFromRoute.value || reservedPrefixes.includes(teamSlugFromRoute.value) || teamSlugFromRoute.value.includes('.') || teamTranslationsLoaded.value) {
      return
    }

    // If a request is already in-flight, piggyback on it
    if (_pendingLoad) {
      await _pendingLoad
      return
    }

    const team = teamSlugFromRoute.value
    const loc = locale.value

    _pendingLoad = (async () => {
      try {
        // Re-check after winning the race — another caller may have finished first
        if (teamTranslationsLoaded.value) return

        const data = await $fetch(`/api/teams/${team}/translations-ui/with-system`, {
          query: { locale: loc }
        })

        if (data && Array.isArray(data)) {
          // Build a map of keyPath to values for quick lookup
          const translationMap: Record<string, string> = {}

          for (const item of data) {
            // Use team override if available, otherwise use system values
            const values = (item as any).teamValues || (item as any).systemValues
            if (values && values[loc]) {
              translationMap[item.keyPath] = values[loc]
            }
          }

          teamTranslations.value = translationMap
          teamTranslationsLoaded.value = true
        }
      } catch (error) {
        console.error('[useT] Failed to load team translations:', error)
      } finally {
        _pendingLoad = null
      }
    })()

    await _pendingLoad
  }

  // Watch for team or locale changes and reload translations.
  // Client: singleton watch (module-level guard) — all useT() calls share one watcher.
  // Server: always create (module re-imports per request, so guard is fresh).
  if (import.meta.server || !_clientWatchActive) {
    if (import.meta.client) _clientWatchActive = true

    watch([teamSlugFromRoute, locale], () => {
      teamTranslationsLoaded.value = false
      teamTranslations.value = {}
      _pendingLoad = null
      if (import.meta.client) {
        loadTeamTranslations()
      } else if (import.meta.server) {
        try {
          const event = useRequestEvent()
          if (event) {
            loadTeamTranslations()
          }
        } catch {
          // No request context available - skip loading on server
        }
      }
    }, { immediate: true })
  }

  /**
   * Enhanced translation function
   * @param key - Translation key (e.g., 'common.save')
   * @param options - Translation options
   * @returns Translated string
   */
  const translate = (key: string, options: TranslationOptions | string = {}): string => {
    if (typeof options === 'string') {
      options = { fallback: options }
    }
    const { params: explicitParams, fallback, category = 'ui', mode = 'team', placeholder, ...rest } = options
    // Support both the explicit `{ params: {...} }` form and the documented
    // shorthand `t(key, { count, name })` form (see TranslationOptions). Without
    // this, shorthand named params never reach interpolation and vue-i18n renders
    // the placeholders as empty strings.
    const params = explicitParams ?? (Object.keys(rest).length ? rest : undefined)

    // Get the translated value
    let translatedValue: string
    let isTranslationMissing = false

    // Check team overrides first
    const currentTeamSlug = teamSlugFromRoute.value
    const teamOverride = teamTranslations.value?.[key]

    if (teamOverride) {
      translatedValue = teamOverride
    } else if (i18n) {
      // Fall back to system translation
      const systemValue = params ? i18n.t(key, params as any) : i18n.t(key)

      // Check if translation is missing (i18n returns the key when not found)
      if (systemValue === key) {
        isTranslationMissing = true
        // Simple [key] format for missing translations
        translatedValue = fallback || placeholder || `[${key}]`
      } else {
        translatedValue = systemValue
      }
    } else {
      // i18n not available - use fallback or key
      isTranslationMissing = true
      translatedValue = fallback || placeholder || `[${key}]`
    }

    // Apply parameter substitution.
    // `??`, never `||`: a count of 0 (or `false`) is a REAL value, and `||` blanked it —
    // "{count} orders deleted" rendered as " orders deleted" (#1756). A genuinely absent
    // param is still `undefined` and still renders empty, so nothing else changes.
    // Mostly a no-op on the vue-i18n path (it has already substituted by here); this is
    // the ONLY substitution for a team-overridden string, which skips vue-i18n entirely.
    if (params && translatedValue) {
      translatedValue = translatedValue.replace(/\{(\w+)\}/g, (_, k) => String(params[k] ?? ''))
    }

    return translatedValue
  }

  /**
   * Get translation metadata for dev mode
   * @param key - Translation key
   * @param options - Translation options
   * @returns Translation metadata
   */
  const getTranslationInfo = (key: string, options: TranslationOptions = {}) => {
    const { category = 'ui' } = options
    const currentTeamSlug = teamSlugFromRoute.value
    const teamOverride = teamTranslations.value?.[key]
    const systemValue = i18n ? i18n.t(key) : key
    const isTranslationMissing = !i18n || systemValue === key

    return {
      key,
      value: translate(key, options),
      mode: currentTeamSlug ? 'team' : 'system',
      category,
      isMissing: isTranslationMissing,
      hasTeamOverride: !!teamOverride
    }
  }

  /**
   * Simple string-only version for cases where VNode isn't supported
   * @param key - Translation key (e.g., 'common.save')
   * @param options - Translation options
   * @returns Translated string
   */
  const translateString = (key: string, options: TranslationOptions = {}): string => {
    const { params: explicitParams, fallback, placeholder, category: _category, mode: _mode, ...rest } = options
    // Same shorthand-param support as translate() above.
    const params = explicitParams ?? (Object.keys(rest).length ? rest : undefined)

    // Get team overrides
    const teamOverride = teamTranslations.value?.[key]

    let value: string

    if (teamOverride) {
      value = teamOverride
    } else if (i18n) {
      const systemValue = params ? i18n.t(key, params as any) : i18n.t(key)

      // Check if translation is missing
      if (systemValue === key) {
        value = fallback || placeholder || `[${key}]`
      } else {
        value = systemValue
      }
    } else {
      // i18n not available - use fallback or key
      value = fallback || placeholder || `[${key}]`
    }

    // Apply parameter substitution — same `??`-not-`||` rule as translate() (#1756).
    if (params && value) {
      value = value.replace(/\{(\w+)\}/g, (_, k) => String(params[k] ?? ''))
    }

    return value
  }

  /**
   * Reactive translation for content fields
   * @param entity - Entity with translations
   * @param field - Field name to translate
   * @param preferredLocale - Preferred locale (optional)
   * @returns Translated content
   */
  const translateContent = (
    entity: any,
    field: string,
    preferredLocale?: string
  ): string => {
    const loc = preferredLocale || locale.value

    // Try requested locale
    const translated = entity?.translations?.[loc]?.[field]
    if (translated) return translated

    // Try fallback locales (derived from i18n config)
    const fallbackLocales = i18n?.locales?.value?.map((l: any) => typeof l === 'string' ? l : l.code) ?? ['en']
    for (const fallbackLoc of fallbackLocales) {
      if (fallbackLoc === loc) continue // Skip the already tried locale
      const fallbackValue = entity?.translations?.[fallbackLoc]?.[field]
      if (fallbackValue) return fallbackValue
    }

    // Final fallback to the field itself
    return entity?.[field] || ''
  }

  /**
   * Check if a translation exists
   * @param key - Translation key
   * @returns Boolean indicating if translation exists
   */
  const hasTranslation = (key: string): boolean => {
    const teamOverride = teamTranslations.value?.[key]

    if (teamOverride) return true

    if (!i18n) return false

    const systemValue = i18n.t(key)
    return systemValue !== key
  }

  /**
   * Get all available locales
   * @returns Array of available locale codes
   */
  const getAvailableLocales = (): string[] => {
    const availableLocales: string[] = []

    // Derive available locales from i18n config
    const configuredLocales = i18n?.locales?.value?.map((l: any) => typeof l === 'string' ? l : l.code) ?? ['en']
    configuredLocales.forEach((loc: string) => {
      if (!availableLocales.includes(loc)) {
        availableLocales.push(loc)
      }
    })

    return availableLocales
  }

  /**
   * Get translation with metadata (useful for admin interfaces)
   * @param key - Translation key
   * @returns Translation metadata
   */
  const getTranslationMeta = (key: string) => {
    const teamOverride = teamTranslations.value?.[key]
    const systemValue = i18n ? i18n.t(key) : key
    const isSystemMissing = !i18n || systemValue === key

    return {
      key,
      value: teamOverride || systemValue,
      hasTeamOverride: !!teamOverride,
      isSystemMissing,
      availableLocales: getAvailableLocales()
    }
  }

  // Also expose a method to invalidate cache
  const refreshTranslations = async () => {
    teamTranslationsLoaded.value = false
    await loadTeamTranslations()
  }

  return {
    t: translate,
    tString: translateString,
    tContent: translateContent,
    tInfo: getTranslationInfo,
    hasTranslation,
    getAvailableLocales,
    getTranslationMeta,
    refreshTranslations,
    locale,
    isDev,
    devModeEnabled
  }
}
