<!--
  The Settings tab of the page editor: the page's identity (title + slug), who edited it when,
  and the SettingsPanel (type, visibility, navigation, layout, parent, chrome flags, access
  code). Since #2326 (slice 5 of #1640) it owns the logic behind those controls, not just the
  markup: the editor hands it the page record (`v-model:page`) plus the list of pages, and
  everything else is derived here.
-->
<script setup lang="ts">
import { useTimeAgo } from '@vueuse/core'

interface PageTypeInfo {
  icon?: string
  name?: string
  description?: string
  fullId?: string
  preferredLayout?: string
}

interface PageRow { id: string, parentId?: string | null, title?: string, slug?: string }

type PageState = Record<string, any> & { id?: string | null }

const props = defineProps<{
  action: 'create' | 'update'
  editingLocale: string
  hasAi: boolean
  selectedPageType?: PageTypeInfo | null
  /** Every page of the team, for the parent picker (fetched by the editor). */
  pages: PageRow[]
  pagesPending: boolean
}>()

/** The page record from usePageRecord — the controls write straight into it. */
const page = defineModel<PageState>('page', { required: true })

const { t } = useT()
const { pageTypes, getPageType } = usePageTypes()

// ── Identity (title + slug) ──
const metaFields = ['title', 'slug']
const fieldOptions = { slug: { transform: 'slug' as const } }
const fieldPlaceholders = computed(() => ({
  title: t('pages.editor.titlePlaceholder', 'Untitled page'),
  slug: t('pages.editor.slugPlaceholder', 'page-url-slug'),
}))

// ── Metadata line: who created / edited, when ──
const createdTimeAgo = useTimeAgo(() => page.value.createdAt)
const updatedTimeAgo = useTimeAgo(() => page.value.updatedAt)
const createdByName = computed(() => page.value.createdByUser?.name || page.value.createdByUser?.email)
const updatedByName = computed(() => page.value.updatedByUser?.name || page.value.updatedByUser?.email)
const hasMetadata = computed(() => props.action === 'update' && !!(page.value.createdAt || page.value.updatedAt))

// ── Page type / layout / parent options ──
// name/description are i18n keys (package types) or plain strings (collection-derived
// types); t(value, value) returns the plain ones verbatim instead of "[value]".
const pageTypeOptions = computed(() =>
  pageTypes.value.map((type: any) => ({
    value: type.fullId,
    label: t(type.name, type.name),
    description: type.description ? t(type.description, type.description) : undefined,
    icon: type.icon,
  })),
)
const layoutOptions = [
  { value: 'default', label: t('pages.layout.default') },
  { value: 'full-height', label: t('pages.layout.fullHeight') },
  { value: 'full-screen', label: t('pages.layout.fullScreen') },
]
/** Every page as an indented tree, with this page and its descendants disabled (no cycles). */
const parentOptions = computed(() => {
  const options: { value: string | null, label: string, disabled?: boolean }[] = [{ value: null, label: t('pages.parent.root') }]
  const pages = props.pages
  if (!pages?.length) return options
  const excludeIds = new Set<string>()
  const collect = (parentId: string) => {
    for (const p of pages) {
      if (p.parentId === parentId) { excludeIds.add(p.id); collect(p.id) }
    }
  }
  const currentId = page.value.id
  if (currentId) { excludeIds.add(currentId); collect(currentId) }
  const build = (parentId: string | null, depth: number) => {
    for (const p of pages.filter(x => (x.parentId ?? null) === parentId)) {
      options.push({ value: p.id, label: `${'— '.repeat(depth)}${p.title || p.slug || t('pages.untitled')}`, disabled: excludeIds.has(p.id) })
      build(p.id, depth + 1)
    }
  }
  build(null, 0)
  return options
})

// A new page follows its type's preferred layout until the author picks one by hand.
const layoutManuallyChanged = ref(false)
watch(() => page.value.pageType, (newPageType) => {
  if (props.action === 'create' && !layoutManuallyChanged.value) {
    page.value.layout = (getPageType(newPageType) as any)?.preferredLayout || 'default'
  }
}, { immediate: true })
function onLayoutChange() { layoutManuallyChanged.value = true }

// ── Chrome flags (config.hideNav / config.hideAuthControls): hide the public page's nav
// pill and/or login/account controls. Stored sparsely: false is removed, not persisted. ──
function configChromeFlag(key: 'hideNav' | 'hideAuthControls') {
  return computed<boolean>({
    get: () => !!page.value.config?.[key],
    set: (value) => {
      const config = { ...(page.value.config as Record<string, unknown> | undefined) }
      if (value) config[key] = true
      else delete config[key]
      page.value.config = config
    },
  })
}
const hideNav = configChromeFlag('hideNav')
const hideAuthControls = configChromeFlag('hideAuthControls')

// Mirror of the server's read-time scope derivation, for the editor hint only: a scoped page
// whose content holds a block with `providesScope` (e.g. the sales kassa block) is gated by
// that block's own credential, so the access-code field hides behind a hint.
const registeredCroutonBlocks = (useAppConfig().croutonBlocks ?? {}) as Record<string, { type?: string, providesScope?: boolean }>
const scopeProvidingBlockTypes = new Set(
  Object.entries(registeredCroutonBlocks).filter(([, def]) => def?.providesScope).map(([key, def]) => def?.type || key),
)
const scopeProvidedByBlock = computed(() => {
  if (page.value.visibility !== 'scoped' || !scopeProvidingBlockTypes.size) return false
  const docs: unknown[] = [page.value.content, ...Object.values((page.value.translations ?? {}) as Record<string, { content?: unknown }>).map(d => d?.content)]
  return docs.some((raw) => {
    if (!raw) return false
    try {
      const doc = typeof raw === 'string' ? JSON.parse(raw) : raw
      const blocks = Array.isArray((doc as any)?.content) ? (doc as any).content : []
      return blocks.some((b: any) => scopeProvidingBlockTypes.has(b?.type))
    } catch {
      return false
    }
  })
})

// ── Access code for scoped pages ──
const { getTeamId } = useTeamContext()
const hasAccessCode = ref(false)
const accessCodePending = ref(false)
const accessCodeUrl = () => `/api/teams/${getTeamId()}/pages/${page.value.id}/access-code`
watch(() => [page.value.visibility, page.value.id] as const, async ([visibility, id]) => {
  if (visibility !== 'scoped' || !id) { hasAccessCode.value = false; return }
  try {
    hasAccessCode.value = (await $fetch<{ exists: boolean }>(accessCodeUrl())).exists
  } catch {
    hasAccessCode.value = false
  }
}, { immediate: true })
async function setAccessCode(code: string | null) {
  if (!page.value.id) return
  accessCodePending.value = true
  try {
    if (code === null) await $fetch(accessCodeUrl(), { method: 'DELETE' })
    else await $fetch(accessCodeUrl(), { method: 'PUT', body: { code } })
    hasAccessCode.value = code !== null
  } catch (err) {
    console.error(code === null ? 'Failed to remove access code:' : 'Failed to save access code:', err)
  } finally {
    accessCodePending.value = false
  }
}
</script>

<template>
  <div class="mx-auto w-full max-w-3xl px-4 py-4 space-y-6">
    <!-- Page identity — title + slug. Tabs layout + the shared editing
         locale (switcher hidden — the language bar drives it). -->
    <CroutonI18nInput
      v-model="page.translations"
      :fields="metaFields"
      layout="tabs"
      :active-locale="editingLocale"
      hide-locale-switcher
      :show-ai-translate="hasAi"
      field-type="page"
      :field-options="fieldOptions"
      :field-placeholders="fieldPlaceholders"
    >
      <template v-if="hasMetadata" #header>
        <div class="flex items-center gap-3 text-xs text-muted">
          <span v-if="createdByName" class="flex items-center gap-1">
            <UIcon name="i-lucide-user-plus" class="size-3" />
            {{ createdByName }} {{ createdTimeAgo }}
          </span>
          <span v-if="updatedByName && updatedByName !== createdByName" class="flex items-center gap-1">
            <UIcon name="i-lucide-pencil" class="size-3" />
            {{ updatedByName }} {{ updatedTimeAgo }}
          </span>
          <span v-else-if="page.updatedAt && page.updatedAt !== page.createdAt" class="flex items-center gap-1">
            <UIcon name="i-lucide-pencil" class="size-3" />
            {{ t('pages.editor.updated', { time: updatedTimeAgo }) }}
          </span>
        </div>
      </template>
    </CroutonI18nInput>

    <USeparator />

    <CroutonPagesEditorSettingsPanel
      :action="action"
      :visibility="page.visibility"
      :show-in-navigation="page.showInNavigation"
      :layout="page.layout"
      :parent-id="page.parentId"
      :page-type="page.pageType"
      :selected-page-type="selectedPageType"
      :page-type-options="pageTypeOptions"
      :layout-options="layoutOptions"
      :parent-options="parentOptions"
      :pages-pending="pagesPending"
      :page-id="page.id"
      :has-access-code="hasAccessCode"
      :access-code-pending="accessCodePending"
      :scope-provided-by-block="scopeProvidedByBlock"
      :hide-nav="hideNav"
      :hide-auth-controls="hideAuthControls"
      @update:page-type="page.pageType = $event"
      @update:show-in-navigation="page.showInNavigation = $event"
      @update:layout="page.layout = $event"
      @update:parent-id="page.parentId = $event"
      @update:hide-nav="hideNav = $event"
      @update:hide-auth-controls="hideAuthControls = $event"
      @layout-change="onLayoutChange"
      @save-access-code="setAccessCode($event)"
      @remove-access-code="setAccessCode(null)"
    />
  </div>
</template>
