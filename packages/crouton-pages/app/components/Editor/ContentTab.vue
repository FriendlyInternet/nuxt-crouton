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
const { locale } = useI18n()
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

// ── Collection item pages (e.g. bookings:bookingsLocations-detail): which item ──
const collectionItemId = computed<string | null>({
  get: () => (config.value as any)?.itemId || null,
  set: (val) => { config.value = { ...config.value, itemId: val } },
})
const collectionLabelKey = computed(() => {
  if (!props.collectionPageName) return 'title'
  return collections.getConfig(props.collectionPageName)?.display?.title || 'title'
})

// Fetch the picked item, then auto-fill title/slug/SEO/og-image once (only empty fields).
// watch + $fetch rather than useFetch: a null URL would be fetched as a relative "null".
const { getTeamId } = useTeamContext()
const selectedCollectionItem = ref<Record<string, any> | null>(null)
watch(
  [() => props.isCollectionPage, collectionItemId, () => props.collectionPageName],
  async ([isCollection, itemId, colName]) => {
    const cfg = isCollection && itemId ? collections.getConfig(colName) : null
    const teamId = getTeamId()
    if (!cfg?.apiPath || !teamId) {
      selectedCollectionItem.value = null
      return
    }
    try {
      const response = await $fetch<any>(`/api/teams/${teamId}/${cfg.apiPath}`, { query: { ids: itemId }, credentials: 'include' })
      const items = response?.items || response
      selectedCollectionItem.value = Array.isArray(items) ? (items[0] || null) : items
    } catch {
      selectedCollectionItem.value = null
    }
  },
)
/** The item's display title: the configured title field, its translation, or the usual fallbacks. */
function pickItemTitle(item: Record<string, any>, titleField: string, loc: string): string | undefined {
  const tr = item.translations as Record<string, Record<string, string>> | undefined
  return item[titleField] || tr?.[loc]?.[titleField] || tr?.en?.[titleField] || item.name || item.title
}

/** Fill title/slug/SEO for the current locale from the picked item — only when the title is still empty. */
function autofillTranslationsFromItem(item: Record<string, any>, title: string, descriptionField: string | undefined, loc: string): void {
  const next = { ...(translations.value as Record<string, Record<string, string>> | null ?? {}) }
  next[loc] = { ...(next[loc] ?? {}) }
  if (next[loc].title) return
  next[loc].title = title
  next[loc].slug = slugify(title)
  next[loc].seoTitle = title
  const description = descriptionField ? item[descriptionField] : undefined
  if (description) next[loc].seoDescription = String(description).slice(0, 160)
  translations.value = next
}

watch(selectedCollectionItem, (item) => {
  if (!item || !props.isCollectionPage) return
  const display = collections.getConfig(props.collectionPageName)?.display
  const loc = locale.value || 'en'
  const title = pickItemTitle(item, display?.title || 'title', loc)
  if (!title) return
  autofillTranslationsFromItem(item, title, display?.description, loc)
  const image = display?.image ? item[display.image] : undefined
  if (image && !ogImage.value) ogImage.value = image
})

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
    <div v-if="isCollectionPage" class="px-4 pt-4 pb-2 shrink-0 border-b border-default">
      <UFormField
        :label="t('pages.editor.selectItem', { name: pageType?.name ? t(pageType.name, pageType.name) : t('pages.editor.item') })"
        name="config.itemId"
      >
        <CroutonFormReferenceSelect
          v-model="collectionItemId"
          :collection="collectionPageName"
          :label="pageType?.name ? t(pageType.name, pageType.name) : undefined"
          :label-key="collectionLabelKey"
        />
      </UFormField>
    </div>

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

    <!-- Config fields for app pages (non-regular, non-collection, non-block-content page types) -->
    <div v-else-if="!isCollectionPage" class="mx-auto w-full max-w-3xl px-4 py-4">
      <template v-if="pageType?.configSchema?.length">
        <USeparator :label="t('pages.editor.pageSettings')" class="my-2" />
        <div class="space-y-4">
          <div v-for="field in pageType.configSchema" :key="field.name" class="text-sm text-muted">
            {{ t('pages.editor.configField', { name: field.name }) }}
          </div>
        </div>
      </template>
      <div v-else class="p-4 bg-muted/30 rounded-lg text-center text-sm text-muted">
        <UIcon name="i-lucide-info" class="size-5 mb-2" />
        <p>{{ t('pages.editor.noConfig') }}</p>
        <p>{{ t('pages.editor.displaysComponent', { name: pageType?.name ? t(pageType.name, pageType.name) : '' }) }}</p>
      </div>
    </div>

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
