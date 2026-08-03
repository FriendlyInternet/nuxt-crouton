<script setup lang="ts">
/**
 * PageEditor Toolbar
 *
 * The action bar at the top of the workspace editor. Deliberately slim: the
 * left side holds only the two controls you flip often — Status and Visibility
 * — plus a single Settings button that opens the roomy SettingsPanel slideover
 * (page type, parent, layout, navigation/chrome toggles and the scoped access
 * code all live there now, not inline). The right side keeps the action group:
 * AI generator, preview, open-in-public, delete/cancel and save.
 *
 * @example
 * <CroutonPagesEditorToolbar
 *   v-model:status="state.status"
 *   v-model:visibility="state.visibility"
 *   :action="action"
 *   :status-config="statusConfig"
 *   :visibility-config="visibilityConfig"
 *   :status-dropdown-items="statusDropdownItems"
 *   :visibility-dropdown-items="visibilityDropdownItems"
 *   :is-regular-page="isRegularPage"
 *   :is-saving="isSaving"
 *   :show-close="showClose"
 *   :page-id="state.id"
 *   :public-url="publicUrl"
 *   :status="state.status"
 *   @show-settings="showSettings = true"
 *   @show-ai-generator="showAiGenerator = true"
 *   @show-preview="showPreview = true"
 *   @cancel="emit('cancel')"
 *   @delete="handleDelete"
 *   @close="emit('close')"
 * />
 */

interface DropdownItem {
  label: string
  icon?: string
  slot?: string
  onSelect?: () => void
}

interface StatusConfigEntry {
  color: string
  icon: string
  label: string
}

interface VisibilityConfigEntry {
  icon: string
  label: string
}

interface Props {
  /** 'create' or 'update' */
  action: 'create' | 'update'
  /** Current page status */
  status: string
  /** Current page visibility */
  visibility: string
  /** Status config map */
  statusConfig: Record<string, StatusConfigEntry>
  /** Visibility config map */
  visibilityConfig: Record<string, VisibilityConfigEntry>
  /** Dropdown items for status selector */
  statusDropdownItems: DropdownItem[][]
  /** Dropdown items for visibility selector */
  visibilityDropdownItems: DropdownItem[][]
  /** Whether to show the AI generator button (regular pages only) */
  isRegularPage: boolean
  /** Whether AI package is available */
  hasAi?: boolean
  /** Whether the save action is in progress */
  isSaving: boolean
  /** Whether to show the X close button (used by InlineEditor) */
  showClose?: boolean
  /** Whether to show the leading back arrow (mobile workspace slideover) */
  showBack?: boolean
  /** Page title shown for context in the bar (truncated) */
  pageTitle?: string
  /** Current page ID (used for delete check) */
  pageId?: string | null
  /** Public URL for the open-in-public button */
  publicUrl?: string | null
}

const props = withDefaults(defineProps<Props>(), {
  showClose: false,
  showBack: false,
  pageTitle: '',
  pageId: null,
  publicUrl: null,
  hasAi: false
})

// Note: status/visibility changes flow through the parent-provided dropdown
// items (statusDropdownItems / visibilityDropdownItems), whose onSelect mutate
// the page state directly — so this toolbar has no update:status/visibility emit.
const emit = defineEmits<{
  'show-ai-generator': []
  'show-preview': []
  'cancel': []
  'delete': []
  'close': []
  'back': []
}>()

const { t } = useT()

// Mobile overflow menu (shown below @lg): the secondary actions that are
// individual buttons on wide screens collapse into a single "⋯" dropdown so the
// toolbar stays one clean row on a phone. Status + Save + Close stay visible.
// Derived bits are hoisted into their own small computeds so the item-builder
// below stays a flat, low-branch assembler.
const showAiAction = computed(() => props.isRegularPage && props.hasAi)
const canDelete = computed(() => props.action === 'update' && !!props.pageId)
// Open the published public page in a new tab. Handled via onSelect + window.open
// (not a `to`/`target` menu item) so the dropdown doesn't decorate it with an
// external-link ↗ glyph — the left icon already signals "opens externally".
function openPublic() {
  if (props.status === 'published' && props.publicUrl && typeof window !== 'undefined') {
    window.open(props.publicUrl, '_blank', 'noopener')
  }
}

// Delete keeps a guard: a nested "Delete? → confirm" step, mirroring the
// two-click CroutonConfirmButton used on wide screens.
const deleteGroup = computed(() => [{
  label: t('common.delete'),
  icon: 'i-lucide-trash-2',
  color: 'error',
  children: [{
    label: t('pages.editor.confirmDelete'),
    icon: 'i-lucide-trash-2',
    color: 'error',
    onSelect: () => emit('delete')
  }]
}])

// Secondary actions (preview / open / AI). Status, visibility and settings are
// NOT here anymore: status + visibility are their own always-visible icon
// dropdowns in the bar, and settings is a tab in the editor body.
const overflowItems = computed(() => {
  const main: any[] = [
    { label: t('pages.editor.preview'), icon: 'i-lucide-eye', onSelect: () => emit('show-preview') }
  ]
  if (props.publicUrl) {
    main.push({ label: t('pages.editor.open'), icon: 'i-lucide-external-link', disabled: props.status !== 'published', onSelect: openPublic })
  }
  if (showAiAction.value) {
    main.push({ label: t('pages.editor.generate'), icon: 'i-lucide-sparkles', onSelect: () => emit('show-ai-generator') })
  }
  return canDelete.value ? [main, deleteGroup.value] : [main]
})
</script>

<template>
  <!-- One consolidated bar: back · status · visibility · name · ⋯ · save -->
  <div class="@container flex items-center gap-1 min-h-11 px-2 py-1.5 border-b border-default bg-elevated/30">
    <!-- Back (mobile workspace slideover only — desktop keeps the sidebar visible) -->
    <UButton
      v-if="showBack"
      class="@lg:hidden shrink-0"
      variant="ghost"
      color="neutral"
      icon="i-lucide-arrow-left"
      size="sm"
      :aria-label="t('common.back')"
      @click="emit('back')"
    />

    <!-- Status — colored LED, label appears when there's room -->
    <UDropdownMenu :items="statusDropdownItems" :content="{ align: 'start' }">
      <UButton
        variant="ghost"
        color="neutral"
        size="xs"
        class="shrink-0 px-1.5 @2xl:px-2"
        :aria-label="statusConfig[status]?.label"
      >
        <span
          :class="[
            'block size-3 rounded-full',
            `bg-${statusConfig[status]?.color || 'warning'}`
          ]"
        />
        <span class="hidden @2xl:inline">{{ statusConfig[status]?.label }}</span>
      </UButton>

      <template #draft="{ item }">
        <span class="flex items-center gap-2">
          <span class="block size-2.5 rounded-full bg-warning" />
          {{ (item as any).label }}
        </span>
      </template>
      <template #published="{ item }">
        <span class="flex items-center gap-2">
          <span class="block size-2.5 rounded-full bg-success" />
          {{ (item as any).label }}
        </span>
      </template>
      <template #archived="{ item }">
        <span class="flex items-center gap-2">
          <span class="block size-2.5 rounded-full bg-error" />
          {{ (item as any).label }}
        </span>
      </template>
    </UDropdownMenu>

    <!-- Visibility — single icon dropdown, always visible, sitting by status -->
    <UDropdownMenu :items="visibilityDropdownItems" :content="{ align: 'start' }">
      <UButton
        variant="ghost"
        color="neutral"
        size="xs"
        class="shrink-0 px-1.5"
        :icon="visibilityConfig[visibility]?.icon || 'i-lucide-globe'"
        :aria-label="visibilityConfig[visibility]?.label"
      />

      <template #public="{ item }">
        <span class="flex items-center gap-2">
          <UIcon name="i-lucide-globe" class="size-4 text-muted" />
          {{ (item as any).label }}
        </span>
      </template>
      <template #members="{ item }">
        <span class="flex items-center gap-2">
          <UIcon name="i-lucide-users" class="size-4 text-muted" />
          {{ (item as any).label }}
        </span>
      </template>
      <template #admin="{ item }">
        <span class="flex items-center gap-2">
          <UIcon name="i-lucide-shield" class="size-4 text-muted" />
          {{ (item as any).label }}
        </span>
      </template>
      <template #scoped="{ item }">
        <span class="flex items-center gap-2">
          <UIcon name="i-lucide-key-round" class="size-4 text-muted" />
          {{ (item as any).label }}
        </span>
      </template>
      <template #hidden="{ item }">
        <span class="flex items-center gap-2">
          <UIcon name="i-lucide-eye-off" class="size-4 text-muted" />
          {{ (item as any).label }}
        </span>
      </template>
    </UDropdownMenu>

    <!-- Page name — context, takes the remaining room and truncates -->
    <span class="min-w-0 flex-1 truncate px-1 text-sm font-medium text-default">
      {{ pageTitle || t('pages.editor.untitledShort', 'Untitled') }}
    </span>

    <!-- Trailing actions: ⋯ overflow · cancel(create) · save · close -->
    <!-- Overflow (preview / open / AI / delete) — one clean icon menu -->
    <UDropdownMenu :items="overflowItems" :content="{ align: 'end' }">
      <UButton
        class="shrink-0"
        variant="ghost"
        color="neutral"
        icon="i-lucide-ellipsis-vertical"
        size="xs"
        :aria-label="t('common.more', 'More')"
      />
    </UDropdownMenu>

    <!-- Cancel (create mode) -->
    <UButton
      v-if="action === 'create'"
      class="shrink-0"
      color="error"
      variant="ghost"
      icon="i-lucide-x"
      size="xs"
      :aria-label="t('common.cancel')"
      @click="emit('cancel')"
    />

    <!-- Save — the bar's primary action (solid) -->
    <UButton
      type="submit"
      class="shrink-0"
      variant="solid"
      color="primary"
      size="xs"
      icon="i-lucide-save"
      :loading="isSaving"
    >
      <span class="hidden @md:inline">{{ action === 'create' ? t('common.create') : t('common.save') }}</span>
    </UButton>

    <!-- Close (inline editor context) -->
    <UButton
      v-if="showClose"
      class="shrink-0"
      variant="ghost"
      color="neutral"
      icon="i-lucide-x"
      size="xs"
      :aria-label="t('common.close')"
      @click="emit('close')"
    />
  </div>
</template>
