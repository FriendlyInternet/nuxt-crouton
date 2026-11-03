<!--
  The Content tab of the page editor (#2324, slice 3 of #1640).

  Owns everything about editing a page's content: which content surface the page type
  gets (block editor · collection item picker · collection-binder config · app-page config
  note), the binder and item settings stored in `config`, the auto-fill of title/slug/SEO
  from a picked collection item, and the AI page generator. The editor passes the page
  type flags and the collab connection in; the models write straight back into the record.
-->
<script setup lang="ts">
interface PageTypeInfo {
  name?: string
  fullId?: string
  collection?: string
  hasBlockContent?: boolean
  configSchema?: Array<{ name: string }>
}

interface Props {
  pageType?: PageTypeInfo | null
  showBlockEditor: boolean
  isCollectionPage: boolean
  isBinderPage: boolean
  collectionPageName: string
  editingLocale: string
  /** The collab connection for the i18n input (crouton-collab's shape, when installed and connected). */
  collab?: any
  hasAi: boolean
  currentLocale: string
  availableLocales: Array<{ code: string, name: string }>
}

const props = defineProps<Props>()

const translations = defineModel<Record<string, any> | null>('translations', { default: () => ({}) })
const config = defineModel<Record<string, any> | null>('config', { default: () => ({}) })
const ogImage = defineModel<string>('ogImage', { default: '' })
/** False while content is being (re)loaded, so the block editor remounts from fresh state. */
const contentReady = defineModel<boolean>('contentReady', { default: true })
const showAiGenerator = defineModel<boolean>('showAiGenerator', { default: false })

const { t } = useT()
const collections = useCollections()

const contentFields = computed(() => (props.showBlockEditor ? ['content'] : []))
const fieldComponents = computed((): Record<string, string> =>
  props.showBlockEditor ? { content: 'CroutonPagesEditorBlockEditorWithPreview' } : {},
)

// ── Collection binder (pages:collection-binder) — the fields live in ContentBinderConfig ──
const collectionOptions = computed(() =>
  Object.keys(collections.configs).map((name) => {
    const cfg = collections.getConfig(name)
    return { value: name, label: cfg?.displayName || cfg?.name || name }
  }),
)

// ── Collection item pages: the picker + autofill live in ContentItemPicker ──

// ── AI page generator: write results into collab (if live) and into the translations ──
// Incrementing key forces CroutonI18nInput to fully remount after AI generation.
const contentKey = ref(0)
async function applyAiContent(results: Array<{ locale: string, content: string, seoTitle: string, seoDescription: string }>) {
  const next = { ...(translations.value as Record<string, Record<string, unknown>> | null ?? {}) }
  for (const { locale: localeCode, content, seoTitle, seoDescription } of results) {
    if (props.collab?.setContentJson) {
      try { props.collab.setContentJson(localeCode, JSON.parse(content), true) } catch { /* fall through to state */ }
    }
    const entry: Record<string, unknown> = { ...(next[localeCode] ?? {}), content }
    if (seoTitle || !next[localeCode]) entry.seoTitle = seoTitle
    if (seoDescription || !next[localeCode]) entry.seoDescription = seoDescription
    next[localeCode] = entry
  }
  translations.value = next
  // Full remount so TipTap reinitialises from state
  contentReady.value = false
  await nextTick()
  contentKey.value++
  contentReady.value = true
}
</script>

<template>
  <div class="flex h-full flex-col">
    <!-- Collection item picker (publishable item pages) -->
    <CroutonPagesEditorContentItemPicker
      v-if="isCollectionPage"
      v-model:config="config"
      v-model:translations="translations"
      v-model:og-image="ogImage"
      :type-name="pageType?.name"
      :collection-name="collectionPageName"
    />

    <!-- Collection binder config -->
    <CroutonPagesEditorContentBinderConfig v-if="isBinderPage" v-model:config="config" :collection-options="collectionOptions" />

    <!-- Block content — fills the tab inline (no summary card / slideout) -->
    <div v-if="showBlockEditor" class="flex flex-1 min-h-0 flex-col px-3 py-3">
      <CroutonI18nInput
        v-if="contentReady"
        :key="contentKey"
        v-model="translations"
        :fields="contentFields"
        layout="tabs"
        :active-locale="editingLocale"
        hide-locale-switcher
        :show-ai-translate="hasAi"
        field-type="page"
        :field-components="fieldComponents"
        :collab="collab"
        class="flex-1 min-h-0"
      />
      <div v-else class="h-full flex items-center justify-center">
        <UIcon name="i-lucide-loader-2" class="size-6 animate-spin text-muted" />
      </div>
    </div>

    <!-- App page types without block content or a bound collection -->
    <CroutonPagesEditorContentTypeNote v-else-if="!isCollectionPage" :page-type="pageType" />

    <!-- AI Page Generator Modal (only when crouton-ai is installed) -->
    <AIPageGenerator
      v-if="hasAi"
      v-model="showAiGenerator"
      :available-locales="availableLocales"
      :current-locale="currentLocale"
      @apply="applyAiContent"
    />
  </div>
</template>
