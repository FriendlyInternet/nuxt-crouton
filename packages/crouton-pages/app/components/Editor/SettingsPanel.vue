<script setup lang="ts">
/**
 * PageEditor SettingsPanel
 *
 * The roomy, organized home for everything you configure about a page. Renders
 * INLINE (it's hosted in the editor's "Settings" tab — #307 mobile redesign),
 * grouping the controls that used to be crammed into the toolbar + its tiny
 * popover into clear sections:
 *
 *   General     — page type, parent page
 *   Appearance  — visual layout/template picker (CroutonPagesEditorLayoutPicker)
 *   Navigation  — show-in-menu, hide nav pill, hide login/account controls
 *   Access      — scoped-visibility access code (only when visibility = scoped)
 *
 * It owns no state: every control re-emits the same `update:*` events the
 * toolbar popover did, so it's a drop-in re-housing for Workspace/Editor.vue.
 *
 * @example
 * <CroutonPagesEditorSettingsPanel
 *   :action="action"
 *   :visibility="state.visibility"
 *   :show-in-navigation="state.showInNavigation"
 *   :layout="state.layout"
 *   :parent-id="state.parentId"
 *   :page-type="state.pageType"
 *   :selected-page-type="selectedPageType"
 *   :page-type-options="pageTypeOptions"
 *   @update:page-type="state.pageType = $event"
 *   :layout-options="layoutOptions"
 *   :parent-options="parentOptions"
 *   :pages-pending="pagesPending"
 *   :page-id="state.id"
 *   :hide-nav="chromeHideNav"
 *   :hide-auth-controls="chromeHideAuthControls"
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
  /** Full id, e.g. 'pages:regular'. */
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
  disabled?: boolean
}

interface Props {
  /** 'create' or 'update' — drives page-type editability. */
  action: 'create' | 'update'
  /** Current page visibility (gates the Access section). */
  visibility: string
  /** Whether page is shown in navigation. */
  showInNavigation: boolean
  /** Current page layout value. */
  layout: string
  /** Current parent page id. */
  parentId: string | null
  /** Current page-type full id (create mode — drives the picker selection). */
  pageType: string
  /** Resolved page type object (for the read-only display in edit mode). */
  selectedPageType?: PageTypeInfo | null
  /** Page-type options for the create-mode picker (icon + name + description). */
  pageTypeOptions: PageTypeOption[]
  /** Layout options for the visual picker. */
  layoutOptions: LayoutOption[]
  /** Parent page options. */
  parentOptions: SelectOption[]
  /** Whether the parent pages list is loading. */
  pagesPending: boolean
  /** Current page id (gates access code on saved pages). */
  pageId?: string | null
  /** Whether the page currently has an access-code grant. */
  hasAccessCode?: boolean
  /** Whether an access-code save/remove is in flight. */
  accessCodePending?: boolean
  /** Whether a scope-providing block makes the page code inert (show hint). */
  scopeProvidedByBlock?: boolean
  /** Per-page chrome: hide the nav pill on the public page. */
  hideNav?: boolean
  /** Per-page chrome: hide the login/account/admin controls on the public page. */
  hideAuthControls?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  selectedPageType: null,
  pageId: null,
  hasAccessCode: false,
  accessCodePending: false,
  scopeProvidedByBlock: false,
  hideNav: false,
  hideAuthControls: false
})

const emit = defineEmits<{
  'update:pageType': [value: string]
  'update:showInNavigation': [value: boolean]
  'update:layout': [value: string]
  'update:parentId': [value: string | null]
  'update:hideNav': [value: boolean]
  'update:hideAuthControls': [value: boolean]
  'layout-change': []
  'save-access-code': [code: string]
  'remove-access-code': []
}>()

const { t } = useT()

// Local input for the scoped-visibility access code — the stored code is hashed
// server-side and never round-trips; hasAccessCode only reports existence, so
// the field always starts empty.
const accessCodeInput = ref('')

function saveAccessCode() {
  const code = accessCodeInput.value.trim()
  if (!code) return
  emit('save-access-code', code)
  accessCodeInput.value = ''
}

const showAccessSection = computed(() => props.visibility === 'scoped')
</script>

<template>
  <div class="space-y-6">
      <!-- ───────── General ───────── -->
      <section class="space-y-3">
        <p class="text-xs font-semibold uppercase tracking-wide text-muted">
          {{ t('pages.editor.sectionGeneral') }}
        </p>

        <!-- Page type — a stacked radio picker in create mode (icon + name +
             description), a read-only summary once the page exists -->
        <UFormField :label="t('pages.fields.pageType')" name="pageType">
          <CroutonPagesEditorPageTypePicker
            v-if="action === 'create'"
            :model-value="pageType"
            :options="pageTypeOptions"
            @update:model-value="(val: string) => emit('update:pageType', val)"
          />

          <div
            v-else
            class="flex items-center gap-2 rounded-md border border-default bg-elevated/30 px-3 py-2"
          >
            <UIcon :name="selectedPageType?.icon || 'i-lucide-file'" class="size-4 text-muted" />
            <div class="min-w-0">
              <div class="truncate text-sm font-medium text-default">
                {{ selectedPageType?.name ? t(selectedPageType.name, selectedPageType.name) : t('pages.editor.regularPage') }}
              </div>
              <div v-if="selectedPageType?.description" class="truncate text-xs text-muted">
                {{ t(selectedPageType.description, selectedPageType.description) }}
              </div>
            </div>
          </div>
        </UFormField>

        <UFormField :label="t('pages.fields.parent')" name="parentId">
          <USelect
            :model-value="parentId"
            :items="parentOptions"
            value-key="value"
            :loading="pagesPending"
            :placeholder="t('pages.editor.noParent')"
            size="sm"
            class="w-full"
            @update:model-value="(val: string | null) => emit('update:parentId', val)"
          />
        </UFormField>
      </section>

      <USeparator />

      <!-- ───────── Appearance ───────── -->
      <section class="space-y-3">
        <p class="text-xs font-semibold uppercase tracking-wide text-muted">
          {{ t('pages.editor.sectionAppearance') }}
        </p>

        <UFormField :label="t('pages.fields.layout')" name="layout">
          <CroutonPagesEditorLayoutPicker
            :model-value="layout"
            :options="layoutOptions"
            @update:model-value="(val: string) => emit('update:layout', val)"
            @layout-change="emit('layout-change')"
          />
        </UFormField>
      </section>

      <USeparator />

      <!-- ───────── Navigation ───────── -->
      <section class="space-y-3">
        <p class="text-xs font-semibold uppercase tracking-wide text-muted">
          {{ t('pages.editor.sectionNavigation') }}
        </p>

        <UFormField
          :label="t('pages.fields.showInNavigation')"
          name="showInNavigation"
          class="flex items-center justify-between gap-4"
        >
          <USwitch
            :model-value="showInNavigation"
            size="sm"
            @update:model-value="emit('update:showInNavigation', $event)"
          />
        </UFormField>

        <UFormField
          :label="t('pages.editor.chromeHideNav')"
          :description="t('pages.editor.chromeHideNavDescription')"
          name="hideNav"
        >
          <USwitch
            :model-value="hideNav ?? false"
            size="sm"
            @update:model-value="emit('update:hideNav', $event)"
          />
        </UFormField>

        <UFormField
          :label="t('pages.editor.chromeHideAuth')"
          :description="t('pages.editor.chromeHideAuthDescription')"
          name="hideAuthControls"
        >
          <USwitch
            :model-value="hideAuthControls ?? false"
            size="sm"
            @update:model-value="emit('update:hideAuthControls', $event)"
          />
        </UFormField>
      </section>

      <!-- ───────── Access (scoped visibility only) ───────── -->
      <template v-if="showAccessSection">
        <USeparator />
        <section class="space-y-3">
          <p class="text-xs font-semibold uppercase tracking-wide text-muted">
            {{ t('pages.editor.sectionAccess') }}
          </p>

          <!-- Scope provided by a content block (e.g. kassa → event helper PIN):
               the page access code is inert, show the hint instead -->
          <UAlert
            v-if="scopeProvidedByBlock"
            color="info"
            variant="subtle"
            icon="i-lucide-key-round"
            :title="t('pages.editor.scopeFromBlockTitle')"
            :description="t('pages.editor.scopeFromBlockDescription')"
          />

          <!-- Access code — only for scoped visibility on a saved page -->
          <UFormField
            v-else-if="pageId"
            :label="t('pages.editor.accessCode')"
            name="accessCode"
            :description="hasAccessCode ? t('pages.editor.accessCodeSet') : t('pages.editor.accessCodeUnset')"
          >
            <div class="flex gap-2">
              <UInput
                v-model="accessCodeInput"
                :placeholder="hasAccessCode ? '••••••' : t('pages.editor.accessCodePlaceholder')"
                icon="i-lucide-key-round"
                size="sm"
                class="flex-1"
                autocomplete="off"
                @keydown.enter.prevent="saveAccessCode"
              />
              <UButton
                size="sm"
                color="primary"
                variant="soft"
                :loading="accessCodePending"
                :disabled="!accessCodeInput.trim()"
                @click="saveAccessCode"
              >
                {{ t('pages.editor.accessCodeSave') }}
              </UButton>
            </div>
            <UButton
              v-if="hasAccessCode"
              size="xs"
              color="error"
              variant="link"
              class="mt-1 px-0"
              :loading="accessCodePending"
              @click="emit('remove-access-code')"
            >
              {{ t('pages.editor.accessCodeRemove') }}
            </UButton>
          </UFormField>
        </section>
      </template>
  </div>
</template>
