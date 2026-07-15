<script setup lang="ts">
/**
 * Inline Editor for Public Pages
 *
 * Wraps the WorkspaceEditor for use in the public page floating panel.
 * No separate header — the WorkspaceEditor's own header bar is used,
 * with a close button injected via the `showClose` prop.
 *
 * Switches to tabbed (single-column) i18n layout when the panel is narrow.
 *
 * Shares reactive translation state via useState so the page preview
 * updates live as the admin types.
 *
 * @example
 * <CroutonPagesInlineEditor
 *   :page-id="pageId"
 *   :panel-width="480"
 *   @close="isEditing = false"
 *   @save="handleSave"
 * />
 */

import { useMediaQuery } from '@vueuse/core'

interface Props {
  pageId?: string | null
  /** Default parent ID for new pages (pre-fills parentId in create mode) */
  defaultParentId?: string | null
}

withDefaults(defineProps<Props>(), {
  pageId: null,
  defaultParentId: null
})

const emit = defineEmits<{
  close: []
  cancel: []
  save: [page: any]
  delete: [id: string]
}>()

// Shared state for live preview — the page route reads this
const editingTranslations = useState<Record<string, any> | null>('editingTranslations', () => null)

// Ref to the WorkspaceEditor (exposes { state } via defineExpose)
const editorRef = ref<{ state: { translations: Record<string, any> } } | null>(null)

// Deep-watch editor translations and sync to shared state for live preview
watch(
  () => editorRef.value?.state?.translations,
  (translations: Record<string, any> | undefined) => {
    if (translations) {
      editingTranslations.value = translations
    }
  },
  { deep: true }
)

function handleSave(page: any) {
  emit('save', page)
}

function handleDelete(id: string) {
  editingTranslations.value = null
  emit('delete', id)
}

function handleCancel() {
  editingTranslations.value = null
  emit('cancel')
}

function handleClose() {
  editingTranslations.value = null
  emit('close')
}

onBeforeUnmount(() => {
  editingTranslations.value = null
})
</script>

<template>
  <div class="h-full flex flex-col">
    <CroutonPagesWorkspaceEditor
      ref="editorRef"
      :page-id="pageId"
      :default-parent-id="defaultParentId"
      show-close
      @save="handleSave"
      @delete="handleDelete"
      @cancel="handleCancel"
      @close="handleClose"
    />
  </div>
</template>
