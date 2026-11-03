import type { Ref } from 'vue'
import type { CollabConnection } from './useTranslationFields'

// ─── Composable ───────────────────────────────────────────────────────────────

export function useAiTranslation(
  locales: Ref<any[]>,
  collab: Ref<CollabConnection | undefined>,
  fieldType: Ref<string | undefined>,
  getFieldValue: (field: string, localeCode: string) => string,
  updateFieldValue: (field: string, value: string, localeCode?: string) => void,
  isBlockEditorField: (field: string) => boolean,
) {
  const notify = useNotify()
  const { t } = useT()

  // Per-field-locale translation loading state
  const isTranslating = ref<Record<string, boolean>>({})

  // Force re-mount key for block editors after translation
  const blockEditorRefreshKey = ref(0)

  // Block editor translation confirmation state
  const pendingBlockTranslation = ref<{ field: string; locale: string } | null>(null)
  const showBlockTranslateConfirm = ref(false)

  // ─── Content helpers ──────────────────────────────────────────────────────

  // Check if a value has meaningful content (handles strings, JSON, and TipTapDoc objects)
  function hasContent(value: unknown): boolean {
    if (!value) return false

    if (typeof value === 'object' && value !== null) {
      const doc = value as { type?: string; content?: unknown[] }
      if (Array.isArray(doc.content)) {
        return doc.content.length > 0 && doc.content.some((node) => {
          const n = node as { type?: string; content?: unknown[]; attrs?: unknown }
          if (n.type === 'paragraph' && (!n.content || n.content.length === 0)) {
            return false
          }
          return true
        })
      }
      return false
    }

    if (typeof value !== 'string') return false
    const trimmed = value.trim()
    if (!trimmed) return false

    if (trimmed.startsWith('{')) {
      try {
        const parsed = JSON.parse(trimmed)
        return parsed?.content?.length > 0
      } catch {
        return true // Not JSON, treat as text
      }
    }
    return true
  }

  // Get all translations for a field (for AI context)
  // In collab mode for block editors, reads live content from Yjs fragments
  function getAllTranslationsForField(field: string): Record<string, string> {
    const translations: Record<string, string> = {}
    const isBlockField = isBlockEditorField(field)

    locales.value.forEach((loc) => {
      const localeCode = typeof loc === 'string' ? loc : loc.code

      if (isBlockField && collab.value?.getContentJson) {
        const liveContent = collab.value.getContentJson(localeCode)
        if (liveContent && typeof liveContent === 'object') {
          translations[localeCode] = JSON.stringify(liveContent)
        }
      } else {
        const value = getFieldValue(field, localeCode)
        if (value) {
          translations[localeCode] = value
        }
      }
    })

    return translations
  }

  // Find the best source locale for translation (prefers EN, then any with content)
  function findBestSourceLocale(field: string, targetLocale: string): string | null {
    const allTranslations = getAllTranslationsForField(field)

    const candidates = Object.entries(allTranslations)
      .filter(([loc, value]) => loc !== targetLocale && hasContent(value))

    if (candidates.length === 0) return null

    const english = candidates.find(([loc]) => loc === 'en')
    if (english) return 'en'

    return candidates[0]![0]
  }

  // ─── Status helpers ───────────────────────────────────────────────────────

  function isFieldTranslating(field: string, targetLocale?: string): boolean {
    const targetLang = targetLocale || 'en'
    return isTranslating.value[`${targetLang}-${field}`] || false
  }

  function hasSourceContent(field: string, targetLocale?: string): boolean {
    const target = targetLocale || 'en'
    return findBestSourceLocale(field, target) !== null
  }

  function hasTargetContent(field: string, targetLocale: string): boolean {
    return hasContent(getFieldValue(field, targetLocale))
  }

  function getTranslateTooltip(field: string, targetLocale: string): string {
    const sourceLang = findBestSourceLocale(field, targetLocale)
    if (!sourceLang) return t('i18n.ai.translate')
    return t('i18n.ai.translateFrom', { locale: sourceLang.toUpperCase() })
  }

  function getBestSourceText(field: string, targetLocale: string): string | undefined {
    const sourceLang = findBestSourceLocale(field, targetLocale)
    if (!sourceLang) return undefined
    return getAllTranslationsForField(field)[sourceLang]
  }

  // ─── Toast helpers ────────────────────────────────────────────────────────

  function showTranslationError(errorMessage: string) {
    if (errorMessage.includes('API key not configured') || errorMessage.includes('No AI API key')) {
      notify.warning(t('i18n.ai.notConfigured'), {
        description: t('i18n.ai.notConfiguredDescription'),
        icon: 'i-lucide-key',
      })
    } else {
      notify.error(t('i18n.ai.failed'), {
        description: errorMessage,
        icon: 'i-lucide-alert-circle',
      })
    }
  }

  // ─── Translation requests ─────────────────────────────────────────────────

  async function requestTranslation(field: string, targetLocale?: string) {
    const targetLang = targetLocale || 'en'
    const allTranslations = getAllTranslationsForField(field)

    const sourceLang = findBestSourceLocale(field, targetLang)
    if (!sourceLang) return

    const sourceText = allTranslations[sourceLang]
    if (!sourceText || targetLang === sourceLang) return

    const translationKey = `${targetLang}-${field}`
    isTranslating.value[translationKey] = true

    try {
      if (isBlockEditorField(field)) {
        let content: any
        try {
          content = typeof sourceText === 'string' ? JSON.parse(sourceText) : sourceText
        } catch {
          console.error('Failed to parse block content')
          return
        }

        const result = await $fetch<{ content: any; translatedCount?: number }>('/api/ai/translate-blocks', {
          method: 'POST',
          body: { content, sourceLanguage: sourceLang, targetLanguage: targetLang },
        })

        if (result?.content) {
          updateFieldValue(field, JSON.stringify(result.content), targetLang)
        }
      } else {
        const result = await $fetch<{ text: string; confidence?: number }>('/api/ai/translate', {
          method: 'POST',
          body: {
            sourceText,
            sourceLanguage: sourceLang,
            targetLanguage: targetLang,
            fieldType: fieldType.value || field,
            existingTranslations: allTranslations,
          },
        })

        if (result?.text) {
          updateFieldValue(field, result.text, targetLang)
        }
      }
    } catch (err: any) {
      console.error('Translation error:', err)
      const errorMessage = err?.data?.statusMessage || err?.message || t('i18n.ai.failed')

      if (errorMessage.includes('API key not configured')) {
        notify.warning(t('i18n.ai.notConfigured'), {
          description: t('i18n.ai.notConfiguredDescription'),
          icon: 'i-lucide-key',
        })
      } else {
        notify.error(t('i18n.ai.failed'), {
          description: errorMessage,
          icon: 'i-lucide-alert-circle',
        })
      }
    } finally {
      isTranslating.value[translationKey] = false
    }
  }

  async function requestBlockTranslation(field: string, targetLocale: string) {
    const sourceLang = findBestSourceLocale(field, targetLocale)
    if (!sourceLang) return

    const allTranslations = getAllTranslationsForField(field)
    const sourceText = allTranslations[sourceLang]
    if (!sourceText) return

    const translationKey = `${targetLocale}-${field}`
    isTranslating.value[translationKey] = true

    try {
      let content: any
      try {
        content = typeof sourceText === 'string' ? JSON.parse(sourceText) : sourceText
      } catch {
        return
      }

      const result = await $fetch<{ content: any; translatedCount?: number; totalCount?: number }>('/api/ai/translate-blocks', {
        method: 'POST',
        body: { content, sourceLanguage: sourceLang, targetLanguage: targetLocale },
      })

      if (result?.content) {
        const serialized = JSON.stringify(result.content)

        if (collab.value?.setContentJson) {
          collab.value.setContentJson(targetLocale, result.content, true)
          notify.success(t('i18n.ai.complete'), {
            description: t('i18n.ai.translatedBlocks', { count: result.translatedCount ?? 0 }),
            icon: 'i-lucide-check',
          })
        } else if (collab.value) {
          notify.success(t('i18n.ai.saved'), {
            description: t('i18n.ai.translatedBlocksReload', { count: result.translatedCount ?? 0 }),
            icon: 'i-lucide-check',
          })
        }

        updateFieldValue(field, serialized, targetLocale)
        blockEditorRefreshKey.value++
      }
    } catch (err: any) {
      const errorMessage = err?.data?.statusMessage || err?.message || t('i18n.ai.failed')
      showTranslationError(errorMessage)
    } finally {
      isTranslating.value[translationKey] = false
    }
  }

  // ─── Block translation confirmation flow ──────────────────────────────────

  function confirmBlockTranslation(field: string, locale: string) {
    if (hasTargetContent(field, locale)) {
      pendingBlockTranslation.value = { field, locale }
      showBlockTranslateConfirm.value = true
    } else {
      requestBlockTranslation(field, locale)
    }
  }

  function cancelBlockTranslation() {
    pendingBlockTranslation.value = null
    showBlockTranslateConfirm.value = false
  }

  function proceedWithBlockTranslation() {
    if (pendingBlockTranslation.value) {
      const { field, locale } = pendingBlockTranslation.value
      requestBlockTranslation(field, locale)
    }
    pendingBlockTranslation.value = null
    showBlockTranslateConfirm.value = false
  }

  return {
    isTranslating,
    blockEditorRefreshKey,
    showBlockTranslateConfirm,
    pendingBlockTranslation,
    // helpers
    hasContent,
    getAllTranslationsForField,
    findBestSourceLocale,
    isFieldTranslating,
    hasSourceContent,
    hasTargetContent,
    getTranslateTooltip,
    getBestSourceText,
    // actions
    requestTranslation,
    requestBlockTranslation,
    confirmBlockTranslation,
    cancelBlockTranslation,
    proceedWithBlockTranslation,
  }
}
