<script setup lang="ts">
/**
 * Page Renderer Component
 *
 * Renders a page based on its page type. For regular pages, auto-detects
 * content format (blocks JSON vs legacy HTML) and renders accordingly.
 * For app pages, renders the registered component.
 *
 * Content is fetched from translations.{locale}.content with fallback to English.
 */
import { detectContentFormat } from '../utils/content-detector'

interface TranslationData {
  title?: string
  slug?: string
  content?: string
}

interface PageRecord {
  id: string
  teamId: string
  title: string
  slug: string
  pageType: string
  content?: string | null
  config?: Record<string, unknown> | null
  status: string
  visibility: string
  showInNavigation: boolean
  parentId?: string | null
  order: number
  translations?: Record<string, TranslationData>
}

interface Props {
  /** The page record to render */
  page: PageRecord
  /** Override locale for preview purposes (defaults to current i18n locale) */
  locale?: string
}

const props = defineProps<Props>()

// useT() rather than raw useI18n(): safe on public/SSR routes where the i18n
// auto-import can be unavailable ("useI18n is not defined").
const { locale: i18nLocale } = useT()
const { getPageType } = usePageTypes()
const { t } = useT()

const effectiveLocale = computed(() => props.locale || i18nLocale.value)

/**
 * Get localized content with fallback to English
 */
const localizedContent = computed(() => {
  const translations = props.page.translations
  if (!translations) {
    // Fallback to legacy content field
    return props.page.content
  }

  // Try effective locale first, then English fallback
  const localeData = translations[effectiveLocale.value] || translations.en
  return localeData?.content || props.page.content
})

/**
 * Resolved page type information
 */
const pageType = computed(() => {
  if (!props.page.pageType || props.page.pageType === 'regular') {
    return getPageType('core:regular')
  }
  return getPageType(props.page.pageType)
})

/**
 * Component to render based on page type
 */
const componentName = computed(() => {
  return (pageType.value as any)?.component || 'CroutonPagesRegularContent'
})

/**
 * Props to pass to the component
 */
const componentProps = computed(() => {
  const defaultProps = (pageType.value as any)?.defaultProps || {}
  const pageConfig = props.page.config || {}

  return {
    ...defaultProps,
    ...pageConfig,
    page: props.page
  }
})

/**
 * Check if this is a regular content page
 * Handles: undefined, 'regular', 'core:regular', 'pages:regular'
 */
const isRegularPage = computed(() => {
  const pt = props.page.pageType
  return !pt || pt === 'regular' || pt === 'core:regular' || pt === 'pages:regular' || pt.endsWith(':regular')
})

/**
 * Detect content format for regular pages
 * Returns: 'blocks' | 'html' | 'empty'
 */
const contentFormat = computed(() => {
  if (!isRegularPage.value) return null
  return detectContentFormat(localizedContent.value)
})

</script>

<template>
  <div class="page-renderer h-full">
    <!-- Regular page: detect format and render accordingly -->
    <template v-if="isRegularPage">
      <!-- Block-based content (new format) -->
      <CroutonPagesBlockContent
        v-if="contentFormat === 'blocks'"
        :content="localizedContent"
        :header-media="!!(page.config as Record<string, unknown> | undefined)?.headerMedia"
      />

      <!-- Legacy HTML content -->
      <CroutonPagesRegularContent
        v-else-if="contentFormat === 'html'"
        :content="localizedContent"
      />

      <!-- Empty page -->
      <div
        v-else
        class="text-center py-12 text-muted"
      >
        <UIcon name="i-lucide-file-text" class="size-12 mb-4 mx-auto block" />
        <p>{{ t('pages.noContent') }}</p>
      </div>
    </template>

    <!-- App page type: render the registered component -->
    <template v-else-if="pageType">
      <component
        :is="componentName"
        v-bind="componentProps"
      />
    </template>

    <!-- Unknown page type: show error -->
    <template v-else>
      <div class="p-8 text-center">
        <UIcon name="i-lucide-alert-triangle" class="size-12 text-warning mb-4" />
        <h2 class="text-lg font-semibold mb-2">{{ t('pages.unknownPageType') }}</h2>
        <p class="text-muted">
          {{ t('pages.unknownPageTypeDescription', { type: page.pageType }) }}
        </p>
      </div>
    </template>
  </div>
</template>
