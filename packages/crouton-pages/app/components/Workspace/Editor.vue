<script setup lang="ts">
import { usePageRecord, usePageRecordDeps } from '../../composables/usePageRecord'
/**
 * Workspace Editor - Inline Page Editor
 *
 * Renders the page form inline (not in slideover) for the workspace view.
 * Handles loading page data, saving, and emitting events.
 *
 * @example
 * <CroutonPagesWorkspaceEditor
 *   :page-id="selectedPageId"
 *   @save="handleSave"
 *   @delete="handleDelete"
 * />
 */

interface Props {
  /** Page ID to edit (null for create mode) */
  pageId?: string | null
  /** Default parent ID for new pages (pre-fills parentId in create mode) */
  defaultParentId?: string | null
  /** Show a close button in the header (used by InlineEditor) */
  showClose?: boolean
  /** Show a leading back arrow in the toolbar (mobile workspace slideover) */
  showBack?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  pageId: null,
  defaultParentId: null,
  showClose: false,
  showBack: false,
})

const emit = defineEmits<{
  save: [page: any]
  delete: [id: string]
  cancel: []
  close: []
  back: []
}>()

const { t } = useT()
const { watchDebounced } = await import('@vueuse/core')
const { getPageType } = usePageTypes()
const { locale, locales } = useI18n()
const availableLocales = computed(() =>
  (locales.value as Array<{ code: string, name: string }>).map(l => ({ code: l.code, name: l.name })),
)
const { teamSlug: teamSlugRef } = useTeamContext()

// AI page generator
const showAiGenerator = ref(false)

// The page record — mode, state, load, save, delete — is usePageRecord (#2323). The
// component keeps the screen: when to load, what to do with the result, what to tell the user.
const {
  state, action, isLoading, isSaving, loadError,
  reset: resetRecord, load: loadRecord, save: saveRecord, remove: removeRecord,
} = usePageRecord(
  { pageId: () => props.pageId, defaultParentId: () => props.defaultParentId, fallbackLocale: () => locale.value },
  usePageRecordDeps(() => getCurrentUser().name),
)

// Get current user for collab
const getCurrentUser = () => {
  try {
    if (typeof useSession === 'function') {
      const { user: sessionUser } = useSession()
      if (sessionUser?.value) {
        const u = sessionUser.value as unknown as Record<string, unknown>
        return {
          name: String(u.name || u.email || t('pages.editor.anonymous')),
          color: undefined
        }
      }
    }
  } catch {
    // Auth package not installed
  }
  return { name: t('pages.editor.anonymous'), color: undefined }
}

// Set up collab for content if package is installed
const collabRoomIdForContent = computed(() =>
  action.value === 'update' && props.pageId
    ? `pagesPages-${props.pageId}`
    : null
)

let collabLocalizedContent: any = null

// Set up localized content sync
try {
  // @ts-ignore - useCollabLocalizedContent only exists when crouton-collab is
  // installed (e.g. triage). Apps without it (e.g. velo) can't resolve the name,
  // so the runtime typeof-guard is suppressed here. @ts-expect-error can't be used:
  // it would be flagged as unused in apps where collab IS present.
  if (typeof useCollabLocalizedContent === 'function') {
    // @ts-ignore - see note above (symbol absent without crouton-collab)
    collabLocalizedContent = useCollabLocalizedContent({
      roomId: collabRoomIdForContent.value,
      roomType: 'pagesPages',
      fieldPrefix: 'content',
      user: getCurrentUser()
    })
  }
} catch {
  // Collab package not installed
}

// Collab connection for CroutonI18nInput
const collabForI18n = computed(() => {
  if (!collabLocalizedContent || !collabRoomIdForContent.value) return undefined
  if (!collabLocalizedContent.connected?.value) return undefined
  return {
    getXmlFragment: (locale: string) => collabLocalizedContent.getXmlFragment(locale),
    getContentJson: (locale: string) => collabLocalizedContent.getContentJson(locale),
    setContentJson: (locale: string, content: unknown, force?: boolean) => collabLocalizedContent.setContentJson(locale, content, force),
    connection: collabLocalizedContent.connection,
    user: getCurrentUser()
  }
})

// Fetch all pages for parent selector
const { items: allPages, pending: pagesPending } = await useCollectionQuery('pagesPages')


// Sync title/slug to ghost page in sidebar during creation
const { updateGhost } = useGhostPage()
watch(
  () => {
    const t = state.value.translations as Record<string, { title?: string, slug?: string }> | undefined
    if (!t) return null
    // Use current locale, fall back to first available
    const localeData = t[locale.value] || Object.values(t)[0]
    return { title: localeData?.title, slug: localeData?.slug }
  },
  (val) => {
    if (action.value === 'create' && val) {
      updateGhost({
        title: val.title || t('pages.newPagePlaceholder'),
        slug: val.slug || ''
      })
    }
  },
  { deep: true }
)

// Auto-fill slug from title while typing (create mode only)
// Tracks last auto-generated slug per locale so manual edits are respected
const lastAutoSlug = reactive<Record<string, string>>({})

if (!props.pageId) {
  watchDebounced(
    () => {
      const t = state.value.translations as Record<string, { title?: string }> | undefined
      if (!t) return {} as Record<string, string>
      return Object.fromEntries(
        Object.entries(t).map(([loc, data]) => [loc, data?.title || ''])
      )
    },
    (titles: Record<string, string>) => {
      const translations = state.value.translations as Record<string, Record<string, unknown>>
      if (!translations) return

      for (const [loc, title] of Object.entries(titles)) {
        if (!title) continue
        const currentSlug = (translations[loc]?.slug as string) || ''
        const wasAutoFilled = currentSlug === '' || currentSlug === lastAutoSlug[loc]

        if (wasAutoFilled) {
          const newSlug = slugify(title)
          if (!translations[loc]) translations[loc] = {}
          translations[loc].slug = newSlug
          lastAutoSlug[loc] = newSlug
        }
      }
    },
    { debounce: 300, deep: true }
  )
}

// Track content ready state
const contentReady = ref(action.value === 'create')

// Load page data when pageId changes
watch(
  () => props.pageId,
  async (newId) => {
    if (!newId) {
      resetRecord()
      contentReady.value = true
      return
    }
    const pageData = await loadRecord(newId)
    if (!pageData) return // loadError is set; the error state renders
    contentReady.value = false
    // Initialize collab content if available
    if (collabLocalizedContent && pageData.translations) {
      const translations = pageData.translations as Record<string, { content?: string }>

      watch(
        () => collabLocalizedContent?.synced?.value,
        (synced) => {
          if (synced) {
            for (const [loc, data] of Object.entries(translations)) {
              if (data?.content) {
                try {
                  const contentJson = typeof data.content === 'string'
                    ? JSON.parse(data.content)
                    : data.content
                  collabLocalizedContent.setContentJson(loc, contentJson)
                } catch {
                  // Failed to parse content
                }
              }
            }
            contentReady.value = true
          }
        },
        { immediate: true }
      )
    } else {
      contentReady.value = true
    }
  },
  { immediate: true }
)

// Computed values
const selectedPageType = computed(() => getPageType(state.value.pageType) as any)
const isRegularPage = computed(() => {
  const pt = state.value.pageType
  return !pt || pt === 'regular' || pt === 'core:regular' || pt === 'pages:regular' || pt.endsWith(':regular')
})

// Whether the block editor should be shown (regular pages + page types with hasBlockContent)
const showBlockEditor = computed(() => {
  return isRegularPage.value || selectedPageType.value?.hasBlockContent === true
})

// Collection page type detection (publishable item pages — e.g. bookings:bookingsLocations-detail)
const isCollectionPage = computed(() => !!selectedPageType.value?.collection)
const collectionPageName = computed(() => selectedPageType.value?.collection || '')

// Collection binder page type detection (pages:collection-binder)
const isBinderPage = computed(() => selectedPageType.value?.fullId === 'pages:collection-binder')


// Page type options
// name/description are i18n keys (see each app's app.config.ts pageTypes).
// t() returns the key unchanged when missing, so dynamic collection-derived
// types (plain-string names) stay safe.
// Page-type options for the Settings panel's stacked radio picker (create mode).
// Description is an i18n key authored by the package that registers the type
// (app.config pageTypes); collection-derived types may have none → name only.

// Access code for scoped visibility — manages the ('page', pageId) grant via
// the access-code endpoint. The code is hashed server-side, so we only ever
// know whether one exists.

// Form submission
async function handleSubmit() {
  // Live collab fragments (locale → TipTap JSON) win over the form's content while the
  // block editor is open; the record takes them as plain data.
  const collabContent = collabLocalizedContent && showBlockEditor.value
    ? Object.fromEntries(
        collabLocalizedContent.getActiveFragments()
          .map(({ locale: loc }: { locale: string }) => [loc, collabLocalizedContent.getContentJson(loc)]),
      )
    : null

  const result = await saveRecord({ showBlockEditor: showBlockEditor.value, isRegularPage: isRegularPage.value, collabContent })
  if (!result.ok) {
    if (result.reason === 'title-required') {
      const notify = useNotify()
      notify.error(t('pages.errors.titleRequired'), { description: t('pages.errors.titleRequiredDescription') })
    }
    return
  }
  emit('save', result.page)
}

// Delete handler — confirmation is the two-step "Delete? → confirm" in the
// toolbar's ⋯ overflow menu
function handleDelete() {
  removeRecord().then((id) => {
    if (id) emit('delete', id)
  })
}

// Translatable fields, split across tabs (#307): title + slug live in the
// Settings tab (the page's identity), the block content fills the Content tab.

// Editor body tabs — the page config surfaces (Content / SEO / Settings) as a
// horizontal nav so nothing hides in a slideover or an overflow menu (#307).
// Panels are kept mounted (v-show) so switching tabs never resets the block
// editor / i18n input state.
// Settings is the first/default tab — it carries the page's identity (title,
// slug) plus its setup; Content is the block canvas; SEO is the meta.
const activeTab = ref<'content' | 'seo' | 'settings'>('settings')
type EditorTab = { id: 'content' | 'seo' | 'settings', label: string, icon: string }
const editorTabs = computed<EditorTab[]>(() => {
  const tabs: EditorTab[] = [{ id: 'settings', label: t('pages.editor.settings', 'Settings'), icon: 'i-lucide-settings' }]
  tabs.push({ id: 'content', label: t('pages.editor.tabContent', 'Content'), icon: 'i-lucide-file-text' })
  if (!isCollectionPage.value) tabs.push({ id: 'seo', label: t('pages.editor.tabSeo', 'SEO'), icon: 'i-lucide-search' })
  return tabs
})
// If the active tab disappears (e.g. switching to a collection page drops SEO),
// fall back to Content so the body never goes blank.
watch(editorTabs, (tabs) => {
  if (!tabs.some(tab => tab.id === activeTab.value)) activeTab.value = 'content'
})

// Shared editing locale (#307) — ONE language selector in the editor's language
// bar drives every translatable field across all tabs (title/slug, content,
// SEO). Seeded from the app locale.
const editingLocale = ref<string>(locale.value || 'en')
const localeOptions = computed(() =>
  (locales.value as Array<string | { code: string, name?: string }>).map((l) => {
    const code = typeof l === 'string' ? l : l.code
    const name = typeof l === 'string' ? l : (l.name || l.code)
    return { value: code, label: name }
  })
)
// Multi-locale apps only: a single-locale app needs no selector.
const showLanguageBar = computed(() => localeOptions.value.length > 1)

// Title of the currently-edited locale — used as the SEO-title placeholder (empty SEO title ⇒ falls back to the title).
const currentTitle = computed(() => {
  const tr = state.value.translations as Record<string, { title?: string }> | undefined
  return tr?.[editingLocale.value]?.title || ''
})

// SEO fields are translatable too — they follow the shared editing locale.

// Preview locale (for language selector in preview panel)

// Metadata: created/updated info

// Preview drawer state
const showPreview = ref(false)

// Detect optional packages via croutonApps registration
const { hasApp } = useCroutonApps()
const hasAI = hasApp('ai')

// Build a preview page object from current form state
const previewPage = computed(() => {
  const translations = { ...state.value.translations } as Record<string, { title?: string; slug?: string; content?: string }>

  // In collab mode, pull live content from Yjs fragments
  if (collabLocalizedContent && showBlockEditor.value) {
    const activeFragments = collabLocalizedContent.getActiveFragments?.() || []
    for (const { locale: loc } of activeFragments) {
      const contentJson = collabLocalizedContent.getContentJson(loc)
      if (!translations[loc]) {
        translations[loc] = {}
      }
      translations[loc] = {
        ...translations[loc],
        content: JSON.stringify(contentJson)
      }
    }
  }

  return {
    id: state.value.id || 'preview',
    teamId: '',
    title: '',
    slug: '',
    pageType: state.value.pageType,
    config: state.value.config,
    status: state.value.status,
    visibility: state.value.visibility,
    showInNavigation: state.value.showInNavigation,
    parentId: state.value.parentId,
    order: state.value.order || 0,
    translations
  }
})

// Build public URL for the current page (used by "Open in public" button).
// Resolves the canonical nested path (/{team}/{locale}/{parent}/{child}) via
// usePageLink so the link honors the page hierarchy. Falls back to the flat
// leaf-slug URL when the page isn't in the resolver's list yet (e.g. just
// published and not refetched).
const { resolve: resolvePageUrl } = usePageLink()
const publicUrl = computed(() => {
  const teamSlug = teamSlugRef.value
  if (!teamSlug || action.value === 'create') return null

  const resolved = resolvePageUrl(state.value.id as string | undefined)
  if (resolved) return resolved

  const translations = state.value.translations as Record<string, { slug?: string }> | undefined
  const slug = translations?.[locale.value]?.slug
    || (translations ? Object.values(translations)[0]?.slug : null)
  if (!slug && slug !== '') return null
  const loc = locale.value || 'en'
  return slug ? `/${teamSlug}/${loc}/${slug}` : `/${teamSlug}/${loc}/`
})

// Expose state for parent components (e.g., InlineEditor live preview)
defineExpose({ state })
</script>

<template>
  <div class="h-full flex flex-col">
    <!-- Loading state -->
    <div v-if="isLoading" class="flex-1 flex items-center justify-center">
      <div class="text-center">
        <UIcon name="i-lucide-loader-2" class="size-8 animate-spin text-muted mb-2" />
        <p class="text-sm text-muted">{{ t('pages.editor.loadingPage') }}</p>
      </div>
    </div>

    <!-- Error state -->
    <div v-else-if="loadError" class="flex-1 flex items-center justify-center">
      <div class="text-center">
        <UIcon name="i-lucide-alert-circle" class="size-8 text-error mb-2" />
        <p class="text-sm text-error">{{ loadError }}</p>
        <UButton
          size="sm"
          color="primary"
          variant="soft"
          class="mt-3"
          @click="emit('cancel')"
        >
          {{ t('common.back') }}
        </UButton>
      </div>
    </div>

    <!-- Form -->
    <UForm
      v-else
      :state="state"
      class="flex flex-col h-full"
      @submit="handleSubmit"
    >
      <!-- Consolidated bar: back · status · visibility · name · ⋯ · save -->
      <CroutonPagesEditorToolbar
        :action="action"
        v-model:status="state.status"
        v-model:visibility="state.visibility"
        :is-regular-page="isRegularPage"
        :has-ai="hasAI"
        :is-saving="isSaving"
        :show-close="showClose"
        :show-back="showBack"
        :page-id="state.id"
        :public-url="publicUrl"
        @show-ai-generator="showAiGenerator = true"
        @show-preview="showPreview = true"
        @cancel="emit('cancel')"
        @delete="handleDelete"
        @close="emit('close')"
        @back="emit('back')"
      >
        <!-- Horizontal tab nav — Content / SEO / Settings -->
        <nav class="flex items-center gap-0.5 min-w-0">
          <UButton
            v-for="tab in editorTabs"
            :key="tab.id"
            :variant="activeTab === tab.id ? 'soft' : 'ghost'"
            :color="activeTab === tab.id ? 'primary' : 'neutral'"
            :icon="tab.icon"
            size="sm"
            class="shrink-0 rounded-none border-b-2"
            :class="activeTab === tab.id ? 'border-primary' : 'border-transparent'"
            :data-review="`editor-tab-${tab.id}`"
            @click="activeTab = tab.id"
          >
            {{ tab.label }}
          </UButton>
        </nav>
      </CroutonPagesEditorToolbar>

      <!-- Language bar — one selector drives the translatable fields on every
           tab; Preview opens in the selected language. Multi-locale apps only. -->
      <CroutonSubBar v-if="showLanguageBar">
        <template #leading>
          <USelect
            v-model="editingLocale"
            :items="localeOptions"
            value-key="value"
            icon="i-lucide-languages"
            size="sm"
            class="min-w-40"
          />
        </template>
        <template #trailing>
          <UButton
            variant="ghost"
            color="neutral"
            icon="i-lucide-eye"
            size="sm"
            :label="t('pages.editor.preview')"
            @click="showPreview = true"
          />
        </template>
      </CroutonSubBar>

      <!-- Tab panels — all kept mounted (v-show) so the block editor / i18n
           input never loses state when switching tabs. -->
      <div class="flex-1 min-h-0 overflow-auto">
        <!-- ───────── Settings (title + slug + page setup) ───────── -->
        <!-- Bare wrapper: the extracted tab owns its own layout (`mx-auto max-w-3xl
             px-4 py-4`), so repeating those classes here applied the padding TWICE and
             shifted every control 16px down and right. Matches the SeoTab wrapper. -->
        <div v-show="activeTab === 'settings'">
          <CroutonPagesEditorSettingsTab
            v-model:page="state"
            :action="action"
            :editing-locale="editingLocale"
            :has-ai="hasAI"
            :selected-page-type="selectedPageType"
            :pages="allPages"
            :pages-pending="pagesPending"
          />
        </div>

        <!-- ───────── Content (block editor fills the whole tab) ───────── -->
        <div v-show="activeTab === 'content'" class="flex h-full flex-col">
          <CroutonPagesEditorContentTab
            v-model:translations="state.translations"
            v-model:config="state.config"
            v-model:og-image="state.ogImage"
            v-model:content-ready="contentReady"
            v-model:show-ai-generator="showAiGenerator"
            :page-type="selectedPageType"
            :show-block-editor="showBlockEditor"
            :is-collection-page="isCollectionPage"
            :is-binder-page="isBinderPage"
            :collection-page-name="collectionPageName"
            :editing-locale="editingLocale"
            :collab="collabForI18n"
            :has-ai="hasAI"
            :current-locale="locale"
            :available-locales="availableLocales"
          />
        </div>

        <!-- ───────── SEO & social ───────── -->
        <div v-show="activeTab === 'seo'">
          <CroutonPagesEditorSeoTab
            v-model:translations="state.translations"
            v-model:og-image="state.ogImage"
            v-model:robots="state.robots"
            :editing-locale="editingLocale"
            :current-title="currentTitle"
            :has-ai="hasAI"
            :team-slug="teamSlugRef"
          />
        </div>
      </div>
    </UForm>

    <!-- Preview Slideover (#2325) -->
    <CroutonPagesEditorPreviewSlideover
      v-model:open="showPreview"
      :page="previewPage"
      :initial-locale="editingLocale"
    />

  </div>
</template>
