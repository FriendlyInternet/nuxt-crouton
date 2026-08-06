<script setup lang="ts">
/**
 * PageEditor SettingsTab
 *
 * The Settings tab body of the workspace editor — the page's identity
 * (title/slug, translatable via the shared editing locale) plus the
 * SettingsPanel (page type, parent, layout, navigation/chrome, access code).
 * Extracted from Workspace/Editor.vue's template so that file stays a
 * reasonable size (#1642, part of #1640).
 *
 * Owns no state: props down (meta model, editingLocale, metadata display
 * values), events up (update:translations plus every SettingsPanel event
 * re-emitted unchanged) — a drop-in re-housing of the tab body.
 *
 * @example
 * <CroutonPagesEditorSettingsTab
 *   v-model:translations="state.translations"
 *   :editing-locale="editingLocale"
 *   :has-ai="hasAi"
 *   :field-options="fieldOptions"
 *   :field-placeholders="docFieldPlaceholders"
 *   :has-metadata="hasMetadata"
 *   :created-by-name="createdByName"
 *   :created-time-ago="createdTimeAgo"
 *   :updated-by-name="updatedByName"
 *   :updated-time-ago="updatedTimeAgo"
 *   :updated-at="state.updatedAt"
 *   :created-at="state.createdAt"
 *   :action="action"
 *   :visibility="state.visibility"
 *   :show-in-navigation="state.showInNavigation"
 *   :layout="state.layout"
 *   :parent-id="state.parentId"
 *   :page-type="state.pageType"
 *   :selected-page-type="selectedPageType"
 *   :page-type-options="pageTypeOptions"
 *   :layout-options="layoutOptions"
 *   :parent-options="parentOptions"
 *   :pages-pending="pagesPending"
 *   :page-id="state.id"
 *   :has-access-code="hasAccessCode"
 *   :access-code-pending="accessCodePending"
 *   :scope-provided-by-block="scopeProvidedByBlock"
 *   :hide-nav="chromeHideNav"
 *   :hide-auth-controls="chromeHideAuthControls"
 *   @update:page-type="state.pageType = $event"
 *   @update:show-in-navigation="state.showInNavigation = $event"
 *   @update:layout="state.layout = $event"
 *   @update:parent-id="state.parentId = $event"
 *   @update:hide-nav="chromeHideNav = $event"
 *   @update:hide-auth-controls="chromeHideAuthControls = $event"
 *   @layout-change="onLayoutChange"
 *   @save-access-code="saveAccessCode"
 *   @remove-access-code="removeAccessCode"
 * />
 */

interface PageTypeOption {
  value: string
  label: string
  description?: string
  icon?: string
  disabled?: boolean
}

interface PageTypeInfo {
  icon?: string
  name?: string
  description?: string
  fullId?: string
}

interface SelectOption {
  value: string | null
  label: string
  disabled?: boolean
}

interface LayoutOption {
  value: string
  label: string
}

interface Props {
  translations: Record<string, any>
  editingLocale: string
  hasAi: boolean
  fieldOptions: Record<string, any>
  fieldPlaceholders: Record<string, string>
  hasMetadata?: boolean
  createdByName?: string
  createdTimeAgo?: string
  updatedByName?: string
  updatedTimeAgo?: string
  updatedAt?: unknown
  createdAt?: unknown
  action: 'create' | 'update'
  visibility: string
  showInNavigation: boolean
  layout: string
  parentId: string | null
  pageType: string
  selectedPageType?: PageTypeInfo | null
  pageTypeOptions: PageTypeOption[]
  layoutOptions: LayoutOption[]
  parentOptions: SelectOption[]
  pagesPending: boolean
  pageId?: string | null
  hasAccessCode?: boolean
  accessCodePending?: boolean
  scopeProvidedByBlock?: boolean
  hideNav?: boolean
  hideAuthControls?: boolean
}

defineProps<Props>()

const emit = defineEmits<{
  // Nullable on purpose: the underlying i18n input emits `TranslationsValue`, which
  // includes `null` (a cleared field). Narrowing it to `Record<string, any>` is what
  // broke typecheck when the extraction made this binding explicit.
  'update:translations': [value: Record<string, any> | null]
  'update:pageType': [value: string]
  'update:showInNavigation': [value: boolean]
  'update:layout': [value: string]
  'update:parentId': [value: string | null]
  'update:hideNav': [value: boolean]
  'update:hideAuthControls': [value: boolean]
  'layoutChange': []
  'saveAccessCode': [code: string]
  'removeAccessCode': []
}>()

const { t } = useT()

const metaFields = ['title', 'slug']
</script>

<template>
  <div class="mx-auto w-full max-w-3xl px-4 py-4 space-y-6">
    <!-- Page identity — title + slug. Tabs layout + the shared editing
         locale (switcher hidden — the language bar drives it). -->
    <CroutonI18nInput
      :model-value="translations"
      :fields="metaFields"
      layout="tabs"
      :active-locale="editingLocale"
      hide-locale-switcher
      :show-ai-translate="hasAi"
      field-type="page"
      :field-options="fieldOptions"
      :field-placeholders="fieldPlaceholders"
      @update:model-value="emit('update:translations', $event)"
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
          <span v-else-if="updatedAt && updatedAt !== createdAt" class="flex items-center gap-1">
            <UIcon name="i-lucide-pencil" class="size-3" />
            {{ t('pages.editor.updated', { time: updatedTimeAgo }) }}
          </span>
        </div>
      </template>
    </CroutonI18nInput>

    <USeparator />

    <CroutonPagesEditorSettingsPanel
      :action="action"
      :visibility="visibility"
      :show-in-navigation="showInNavigation"
      :layout="layout"
      :parent-id="parentId"
      :page-type="pageType"
      :selected-page-type="selectedPageType"
      :page-type-options="pageTypeOptions"
      :layout-options="layoutOptions"
      :parent-options="parentOptions"
      :pages-pending="pagesPending"
      :page-id="pageId"
      :has-access-code="hasAccessCode"
      :access-code-pending="accessCodePending"
      :scope-provided-by-block="scopeProvidedByBlock"
      :hide-nav="hideNav"
      :hide-auth-controls="hideAuthControls"
      @update:page-type="emit('update:pageType', $event)"
      @update:show-in-navigation="emit('update:showInNavigation', $event)"
      @update:layout="emit('update:layout', $event)"
      @update:parent-id="emit('update:parentId', $event)"
      @update:hide-nav="emit('update:hideNav', $event)"
      @update:hide-auth-controls="emit('update:hideAuthControls', $event)"
      @layout-change="emit('layoutChange')"
      @save-access-code="emit('saveAccessCode', $event)"
      @remove-access-code="emit('removeAccessCode')"
    />
  </div>
</template>
