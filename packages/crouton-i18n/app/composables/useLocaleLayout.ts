import type { Ref } from 'vue'

// ─── Composable ───────────────────────────────────────────────────────────────

export function useLocaleLayout(
  locales: Ref<any[]>,
  primaryLocaleProp: Ref<string | undefined>,
  secondaryLocaleProp: Ref<string | undefined>,
  layout: Ref<'tabs' | 'side-by-side' | undefined>,
  // Optional externally-controlled editing locale. When set, it drives the
  // single edited locale (tabs mode) so several inputs can share ONE language
  // selector (e.g. the pages editor's language bar). Undefined = self-managed.
  externalLocale?: Ref<string | undefined>,
) {
  // Layout mode (defaults to tabs for backwards compatibility)
  const layoutMode = computed(() => layout.value ?? 'tabs')

  // All locale codes derived from i18n locales
  const allLocaleCodes = computed(() =>
    locales.value.map(l => (typeof l === 'string' ? l : l.code)),
  )

  // Active locale for tabs mode — seeds from the external control when present,
  // else the app locale.
  const { locale } = useI18n()
  const editingLocale = ref(externalLocale?.value || locale.value)

  // Follow the external control when it changes (controlled mode).
  if (externalLocale) {
    watch(externalLocale, (loc) => {
      if (loc && loc !== editingLocale.value) editingLocale.value = loc
    })
  }

  // Left column locale (defaults to 'en' or first available) — for side-by-side
  const primaryEditingLocale = ref(
    primaryLocaleProp.value ||
    (allLocaleCodes.value.includes('en') ? 'en' : allLocaleCodes.value[0]) ||
    'en',
  )

  // Right column locale — for side-by-side (falls back to second available locale)
  const secondaryEditingLocale = ref(
    secondaryLocaleProp.value ||
    allLocaleCodes.value.find(code => code !== primaryEditingLocale.value) ||
    allLocaleCodes.value[1] || 'en',
  )

  // Locale options for dropdowns
  const allLocaleOptions = computed(() =>
    allLocaleCodes.value.map(code => ({ value: code, label: code.toUpperCase() })),
  )

  // Detect when both panels show the same language
  const isSameLocale = computed(() => primaryEditingLocale.value === secondaryEditingLocale.value)

  // Single-locale apps (e.g. nl-only) have no second language to compare/translate —
  // no locale tabs, no dual columns, just one editor.
  const isSingleLocale = computed(() => allLocaleCodes.value.length <= 1)

  // User-togglable column count for side-by-side mode.
  // Forced off for single-locale apps (a second column would duplicate the same locale).
  const _showDualColumns = ref(true)
  const showDualColumns = computed<boolean>({
    get: () => !isSingleLocale.value && _showDualColumns.value,
    set: (v: boolean) => { _showDualColumns.value = v },
  })

  // Narrow-screen tab tracking (shows ALL locales)
  const narrowLocaleTab = ref(primaryEditingLocale.value)

  const narrowLocaleTabs = computed(() =>
    allLocaleCodes.value.map(code => ({
      value: code,
      label: code.toUpperCase(),
    })),
  )

  // Sync narrow tab when primary locale changes
  watch(primaryEditingLocale, (primary) => {
    if (!allLocaleCodes.value.includes(narrowLocaleTab.value)) {
      narrowLocaleTab.value = primary
    }
  })

  // Refs to secondary column BlockEditorWithPreview instances (per field)
  // NOTE: kept here because they are tightly coupled with the isSameLocale watcher
  const secondaryEditorRefs = ref<Record<string, any>>({})

  // When same locale is selected, switch secondary to preview; otherwise editor
  watch(isSameLocale, (same) => {
    for (const editorRef of Object.values(secondaryEditorRefs.value)) {
      if (editorRef) {
        if (same) {
          editorRef.showPreview?.()
        } else {
          editorRef.showEditor?.()
        }
      }
    }
  })

  return {
    layoutMode,
    allLocaleCodes,
    editingLocale,
    primaryEditingLocale,
    secondaryEditingLocale,
    allLocaleOptions,
    isSameLocale,
    isSingleLocale,
    showDualColumns,
    narrowLocaleTab,
    narrowLocaleTabs,
    secondaryEditorRefs,
  }
}
