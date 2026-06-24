<script setup lang="ts">
/**
 * Pages Workspace - Finder-style Page Editor
 *
 * Uses CroutonWorkspaceLayout for the split-panel shell.
 * Adds page-specific logic: ghost pages, createParentId, custom sidebar/editor.
 */

definePageMeta({
  layout: 'admin',
  middleware: ['auth', 'team-admin']
})

const { t } = useT()

// Selected page ID — synced with WorkspaceLayout via v-model
const selectedPageId = ref<string | null>(null)

// Parent ID for new pages (set when creating from tree context)
const createParentId = ref<string | null>(null)

// Ghost page state for sidebar tree
const { setGhost, clearGhost } = useGhostPage()

// Workspace layout ref for programmatic control
const layoutRef = ref<{ select: (item: any) => void; create: () => void; focusSearch: () => void } | null>(null)

// Handle page selection from sidebar
function handleSelectPage(page: any) {
  layoutRef.value?.select(page)
}

// Handle create button (optionally with a parent ID from tree context)
function handleCreate(parentId?: string | null) {
  // Guard against PointerEvent being passed from @click handlers
  const resolvedParentId = (parentId && typeof parentId === 'string') ? parentId : null
  createParentId.value = resolvedParentId
  setGhost(resolvedParentId)
  layoutRef.value?.create()
}

// Handle save - clear ghost
function handleSave(savedItem: any, onSave: (item: any) => void) {
  clearGhost()
  onSave(savedItem)
}

// Handle cancel - clear ghost
function handleCancel(onCancel: () => void) {
  clearGhost()
  onCancel()
}
</script>

<template>
  <CroutonWorkspaceLayout
    ref="layoutRef"
    v-model="selectedPageId"
    query-param="page"
    :title="t('pages.workspace.title') || 'Pages'"
    sidebar-id="pages-sidebar"
  >
    <template #sidebar-actions>
      <UButton
        color="primary"
        variant="ghost"
        icon="i-lucide-plus"
        size="sm"
        aria-label="Create page"
        @click="() => handleCreate()"
      />
    </template>

    <template #sidebar="{ selectedId, onSelect, onCreate }">
      <CroutonPagesWorkspaceSidebar
        v-model="selectedPageId"
        @select="handleSelectPage"
        @create="handleCreate"
      />
    </template>

    <template #content="{ selectedId, mode, sessionKey, onSave, onDelete, onCancel }">
      <CroutonPagesWorkspaceEditor
        :key="sessionKey"
        :page-id="selectedId"
        :default-parent-id="mode === 'create' ? createParentId : null"
        @save="(item: any) => handleSave(item, onSave)"
        @delete="onDelete"
        @cancel="() => handleCancel(onCancel)"
      />
    </template>

    <template #empty="{ onCreate }">
      <CroutonPagesWorkspaceEmptyState
        @create="() => handleCreate()"
      />
    </template>
  </CroutonWorkspaceLayout>
</template>