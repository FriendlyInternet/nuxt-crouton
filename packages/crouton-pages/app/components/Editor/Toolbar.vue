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
  /** Current page ID (used for delete check) */
  pageId?: string | null
  /** Public URL for the open-in-public button */
  publicUrl?: string | null
}

const props = withDefaults(defineProps<Props>(), {
  showClose: false,
  pageId: null,
  publicUrl: null,
  hasAi: false
})

const emit = defineEmits<{
  'update:status': [value: string]
  'update:visibility': [value: string]
  'show-settings': []
  'show-ai-generator': []
  'show-preview': []
  'cancel': []
  'delete': []
  'close': []
}>()

const { t } = useT()

// Mobile overflow menu (shown below @lg): the secondary actions that are
// individual buttons on wide screens collapse into a single "⋯" dropdown so the
// toolbar stays one clean row on a phone. Status + Save + Close stay visible.
// Derived bits are hoisted into their own small computeds so the item-builder
// below stays a flat, low-branch assembler.
const showAiAction = computed(() => props.isRegularPage && props.hasAi)
const canDelete = computed(() => props.action === 'update' && !!props.pageId)
const openTo = computed(() => (props.status === 'published' ? props.publicUrl ?? undefined : undefined))
const visibilityLabel = computed(() => props.visibilityConfig[props.visibility]?.label ?? t('pages.visibility.public'))
const visibilityIcon = computed(() => props.visibilityConfig[props.visibility]?.icon ?? 'i-lucide-globe')
const visibilityChildren = computed(() =>
  Object.entries(props.visibilityConfig).map(([value, cfg]) => ({
    label: cfg.label,
    icon: cfg.icon,
    onSelect: () => emit('update:visibility', value)
  }))
)
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

const overflowItems = computed(() => {
  const main: any[] = [
    { label: t('pages.editor.preview'), icon: 'i-lucide-eye', onSelect: () => emit('show-preview') }
  ]
  if (props.publicUrl) {
    main.push({ label: t('pages.editor.open'), icon: 'i-lucide-external-link', to: openTo.value, target: '_blank', disabled: props.status !== 'published' })
  }
  if (showAiAction.value) {
    main.push({ label: t('pages.editor.generate'), icon: 'i-lucide-sparkles', onSelect: () => emit('show-ai-generator') })
  }
  main.push({ label: t('pages.editor.settings'), icon: 'i-lucide-settings', onSelect: () => emit('show-settings') })
  main.push({ label: visibilityLabel.value, icon: visibilityIcon.value, children: visibilityChildren.value })
  return canDelete.value ? [main, deleteGroup.value] : [main]
})
</script>

<template>
  <div class="@container flex flex-wrap items-center gap-1.5 min-h-9 px-3 py-1.5 border-b border-default bg-elevated/30">
    <!-- Left group: Status, Visibility, Settings -->
    <UFieldGroup>
      <!-- Status -->
      <UDropdownMenu
        :items="statusDropdownItems"
        :content="{ align: 'start' }"
      >
        <UButton
          variant="ghost"
          color="neutral"
          size="xs"
          class="px-2 @4xl:px-3"
        >
          <span
            :class="[
              'block size-3 rounded-full',
              `bg-${statusConfig[status]?.color || 'warning'}`
            ]"
          />
          <span class="hidden @4xl:inline">{{ statusConfig[status]?.label }}</span>
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

      <!-- Visibility -->
      <UDropdownMenu
        :items="visibilityDropdownItems"
        :content="{ align: 'start' }"
      >
        <UButton
          variant="ghost"
          color="neutral"
          size="xs"
          class="hidden @lg:inline-flex px-2 @4xl:px-3"
        >
          <UIcon
            :name="visibilityConfig[visibility]?.icon || 'i-lucide-globe'"
            class="size-4 text-muted"
          />
          <span class="hidden @4xl:inline">{{ visibilityConfig[visibility]?.label }}</span>
        </UButton>

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

      <!-- Settings — opens the roomy SettingsPanel slideover -->
      <UTooltip :text="t('pages.editor.settings')" :delay-duration="0">
        <UButton
          variant="ghost"
          color="neutral"
          icon="i-lucide-settings"
          size="xs"
          class="hidden @lg:inline-flex px-2 @4xl:px-3"
          @click="emit('show-settings')"
        >
          <span class="hidden @4xl:inline">{{ t('pages.editor.settings') }}</span>
        </UButton>
      </UTooltip>
    </UFieldGroup>

    <div class="flex-1" />

    <!-- Right group: AI, Preview, Open, Cancel/Delete/Save, Close -->
    <UFieldGroup>
      <!-- Mobile overflow (below @lg): folds the secondary actions into one menu -->
      <UDropdownMenu
        :items="overflowItems"
        :content="{ align: 'end' }"
      >
        <UButton
          class="@lg:hidden"
          variant="ghost"
          color="neutral"
          icon="i-lucide-ellipsis"
          size="xs"
          :aria-label="t('common.more', 'More')"
        />
      </UDropdownMenu>

      <!-- AI page generator (regular pages only, when crouton-ai is installed) -->
      <UTooltip v-if="isRegularPage && hasAi" :text="t('pages.editor.generateWithAI')" :delay-duration="0">
        <UButton
          variant="ghost"
          color="primary"
          icon="i-lucide-sparkles"
          size="xs"
          class="hidden @lg:inline-flex"
          @click="emit('show-ai-generator')"
        >
          <span class="hidden @4xl:inline">{{ t('pages.editor.generate') }}</span>
        </UButton>
      </UTooltip>

      <!-- Preview -->
      <UTooltip :text="status === 'draft' ? t('pages.editor.previewDraft') : t('pages.editor.previewPage')" :delay-duration="0">
        <UButton
          variant="ghost"
          color="neutral"
          icon="i-lucide-eye"
          size="xs"
          class="hidden @lg:inline-flex"
          @click="emit('show-preview')"
        >
          <span class="hidden @4xl:inline">{{ t('pages.editor.preview') }}</span>
        </UButton>
      </UTooltip>

      <!-- Open in public -->
      <UTooltip
        v-if="publicUrl"
        :text="status === 'published' ? t('pages.editor.openInPublic') : t('pages.editor.publishToOpen')"
        :delay-duration="0"
      >
        <UButton
          :to="status === 'published' ? publicUrl : undefined"
          :disabled="status !== 'published'"
          target="_blank"
          variant="ghost"
          color="neutral"
          icon="i-lucide-external-link"
          size="xs"
          class="hidden @lg:inline-flex"
        >
          <span class="hidden @4xl:inline">{{ t('pages.editor.open') }}</span>
        </UButton>
      </UTooltip>

      <!-- Cancel (create mode) -->
      <UButton
        v-if="action === 'create'"
        color="error"
        variant="ghost"
        icon="i-lucide-x"
        size="xs"
        @click="emit('cancel')"
      >
        {{ t('common.cancel') }}
      </UButton>

      <!-- Delete (two-click confirm, edit mode) — wide only; on mobile it lives in the ⋯ menu -->
      <CroutonConfirmButton
        v-if="action === 'update' && pageId"
        :label="t('common.delete')"
        :confirm-label="t('pages.editor.confirmDelete')"
        icon="i-lucide-trash-2"
        class="hidden @lg:inline-flex"
        @confirm="emit('delete')"
      />

      <!-- Save -->
      <UButton
        type="submit"
        variant="soft"
        color="primary"
        size="xs"
        icon="i-lucide-save"
        :loading="isSaving"
      >
        {{ action === 'create' ? t('common.create') : t('common.save') }}
      </UButton>

      <!-- Close button (shown in inline editor context) -->
      <UButton
        v-if="showClose"
        variant="ghost"
        color="neutral"
        icon="i-lucide-x"
        size="xs"
        @click="emit('close')"
      />
    </UFieldGroup>
  </div>
</template>
