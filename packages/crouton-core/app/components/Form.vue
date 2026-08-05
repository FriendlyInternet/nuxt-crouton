<!-- _Form.vue -->
<template>
  <!-- Modals -->
  <UModal
    v-for="(state, index) in modalStates"
    :key="state.id"
    v-model:open="state.isOpen"
    :title="`${state.action ? state.action.charAt(0).toUpperCase() + state.action.slice(1) : ''} ${getCollectionName(state.collection)}`"
    :description="`Form for ${state.action || 'managing'} ${getCollectionName(state.collection)}`"
    size="lg"
    @update:open="(val: boolean) => handleClose(state.id, val)"
    @after:leave="() => handleAfterLeave(state.id)"
  >
    <template #body>
      <CroutonLoading
        v-if="state.loading !== 'notLoading'"
        class="h-full w-full"
      />

      <CroutonFormDynamicLoader
        v-else
        :key="`${state.collection}-${state.action}-${state.activeItem?.id || 'new'}-${state.id}`"
        :collection="state.collection ?? undefined"
        :loading="state.loading"
        :action="state.action"
        :items="state.items"
        :active-item="state.activeItem"
      />
    </template>
  </UModal>

  <!-- Dialogs -->
  <UModal
    v-for="(state, index) in dialogStates"
    :key="state.id"
    v-model:open="state.isOpen"
    :title="`${state.action ? state.action.charAt(0).toUpperCase() + state.action.slice(1) : ''} ${getCollectionName(state.collection)}`"
    :description="`${state.action ? state.action.charAt(0).toUpperCase() + state.action.slice(1) : ''} ${getCollectionName(state.collection)}`"
    @update:open="(val: boolean) => handleClose(state.id, val)"
    @after:leave="() => handleAfterLeave(state.id)"
  >
    <template #content="{ close }">
      <div class="p-6">
        <div class="flex items-center justify-between mb-4">
          <h2>
            <span class="capitalize">{{ state.action }}</span>
            {{ getCollectionName(state.collection) }}
          </h2>
          <UButton
            icon="i-lucide-x"
            variant="ghost"
            size="xs"
            @click.stop="close()"
          />
        </div>

        <div class="w-full">
          <CroutonLoading
            v-if="state.loading !== 'notLoading'"
            class="h-full w-full"
          />
          <CroutonFormDynamicLoader
            v-else
            :key="`${state.collection}-${state.action}-${state.activeItem?.id || 'new'}-${state.id}`"
            :collection="state.collection ?? undefined"
            :loading="state.loading"
            :action="state.action"
            :items="state.items"
            :active-item="state.activeItem"
          />
        </div>
      </div>
    </template>
  </UModal>

  <!-- Expandable Slideovers -->
  <USlideover
    v-for="(state, index) in slideoverStates"
    :key="state.id"
    v-model:open="state.isOpen"
    :title="`${state.action ? state.action.charAt(0).toUpperCase() + state.action.slice(1) : ''} ${getCollectionName(state.collection)}`"
    :description="`Form for ${state.action || 'managing'} ${getCollectionName(state.collection)}`"
    side="right"
    :close="false"
    :ui="getSlideoverUi(state, index)"
    :style="getSlideoverStyle(state, index)"
    :class="[
      `crouton-slideover-level-${index}`,
      state.isExpanded ? 'crouton-slideover-expanded' : ''
    ]"
    @update:open="(val: boolean) => handleSlideoverClose(state.id, val)"
    @after:leave="() => handleAfterLeave(state.id)"
  >
    <!-- Enhanced actions with presence avatars, expand button, and close -->
    <template #actions>
      <div class="flex items-center gap-2 ml-auto">
        <!-- Collab presence avatars (shows who else is editing) -->
        <!-- Stub in crouton-core, real component in crouton-collab -->
        <CollabEditingBadge
          v-if="state.action === 'update' && state.activeItem?.id"
          :room-id="`${state.collection}-${state.activeItem.id}`"
          :room-type="state.collection || 'generic'"
          :poll-interval="5000"
          size="sm"
          variant="avatars"
        />

        <!-- Expand/Collapse button — no-op on mobile, the slideover is already fullscreen there -->
        <UButton
          :icon="state.isExpanded ? 'i-lucide-minimize-2' : 'i-lucide-maximize-2'"
          variant="ghost"
          color="neutral"
          size="xs"
          class="hidden sm:inline-flex"
          :title="state.isExpanded ? t('form.collapse') : t('form.expand')"
          @click.stop="toggleExpand(state.id)"
        />

        <!-- Close button (inline with other actions) -->
        <UButton
          icon="i-lucide-x"
          variant="ghost"
          color="neutral"
          size="xs"
          :title="t('form.close')"
          @click.stop="handleSlideoverClose(state.id, false)"
        />
      </div>
    </template>

    <!-- Body content -->
    <template #body>
      <div
        v-if="state.isOpen && state.collection"
        class="w-full h-full "
      >
        <CroutonLoading
          v-if="state.loading !== 'notLoading'"
          class="h-full w-full"
        />
        <CroutonFormDynamicLoader
          v-else
          :key="`${state.collection}-${state.action}-${state.activeItem?.id || 'new'}-${state.id}`"
          :collection="state.collection"
          :loading="state.loading"
          :action="state.action"
          :items="state.items"
          :active-item="state.activeItem"
        />
      </div>
    </template>
  </USlideover>
</template>

<script setup lang="ts">
import type { CroutonState } from '../composables/useCrouton'

// Use the composables - destructure only needed properties
const { croutonStates, close, closeAll, removeState } = useCrouton()
const { collectionWithCapitalSingular } = useFormatCollections()
const { t } = useT()

// Filter states by container type
const modalStates = computed(() =>
  croutonStates.value.filter(state => state.containerType === 'modal')
)

const dialogStates = computed(() =>
  croutonStates.value.filter(state => state.containerType === 'dialog')
)

const slideoverStates = computed(() =>
  croutonStates.value.filter(state => state.containerType === 'slideover' || !state.containerType)
)

// Get formatted collection name
const getCollectionName = (collection: string | null): string => {
  return collection ? collectionWithCapitalSingular(collection) : ''
}

// Helper for getting previous slideover safely
const getPreviousSlideover = (index: number) => {
  const prev = slideoverStates.value[index - 1]
  if (index > 0 && prev) {
    return {
      action: prev.action,
      collection: getCollectionName(prev.collection)
    }
  }
  return null
}

// Simple close handler for modals/dialogs
const handleClose = (stateId: string, isOpen: boolean): void => {
  if (!isOpen) {
    const state = croutonStates.value.find(s => s.id === stateId)
    if (state) state.isOpen = false
  }
}

// Handle slideover close event - just update the open state
const handleSlideoverClose = (stateId: string, isOpen: boolean): void => {
  if (!isOpen) {
    // Find the state and set isOpen to false to trigger animation
    const state = slideoverStates.value.find(s => s.id === stateId)
    if (state) {
      state.isOpen = false
    }
  }
}

// Handle after leave animation complete - actually remove the state
const handleAfterLeave = (stateId: string): void => {
  removeState(stateId)
}

// Toggle expand/collapse state for a slideover
const toggleExpand = (stateId: string): void => {
  const state = slideoverStates.value.find(s => s.id === stateId)
  if (state) {
    state.isExpanded = !state.isExpanded
  }
}

// Get dynamic UI configuration based on expand state
const getSlideoverUi = (state: CroutonState, index: number) => {
  const baseTransition = 'transition-[width,max-width,left,right] duration-[400ms] ease-in-out'

  if (state.isExpanded) {
    // Fullscreen mode - override to full width
    return {
      content: `fixed inset-0 w-screen max-w-none ${baseTransition}`,
      overlay: 'fixed inset-0 bg-gray-900/80 backdrop-blur-sm transition-opacity duration-300',
      body: `flex-1 overflow-y-auto p-6 ${baseTransition}`,
      header: 'flex items-center gap-1.5 p-4 sm:px-6 min-h-16 sm:min-h-16 border-b border-gray-200 dark:border-gray-700',
      description: 'sr-only sm:not-sr-only'
    }
  }

  // Sidebar mode - right-side panel with custom width
  return {
    content: `fixed right-0 inset-y-0 w-full max-w-2xl ${baseTransition}`,
    body: `flex-1 overflow-y-auto p-4 ${baseTransition}`,
    header: 'flex items-center gap-1.5 p-4 sm:px-6 min-h-16 sm:min-h-16 border-b border-gray-200 dark:border-gray-700',
    description: 'sr-only sm:not-sr-only'
  }
}

// Get dynamic style based on expand state with smooth transitions
const getSlideoverStyle = (state: CroutonState, index: number) => {
  const baseZIndex = 40 + (index * 10)

  // For expanded state, only adjust positioning, let CSS handle width
  if (state.isExpanded) {
    return {
      zIndex: baseZIndex + 100
      // Remove transition from inline styles - handle in CSS
    }
  }
  // Cascading offsets for stacked view
  return {
    zIndex: baseZIndex,
    top: `${index * 40}px`,
    height: `calc(100vh - ${index * 40}px)`
    // Remove transition from inline styles
  }
}

// Clean up on unmount
onBeforeUnmount(() => {
  closeAll()
})
</script>

<style scoped>
/* Smooth animations for all slideover levels */
:deep(.crouton-slideover-level-0 [data-headlessui-state="open"]),
:deep(.crouton-slideover-level-1 [data-headlessui-state="open"]),
:deep(.crouton-slideover-level-2 [data-headlessui-state="open"]),
:deep(.crouton-slideover-level-3 [data-headlessui-state="open"]),
:deep(.crouton-slideover-level-4 [data-headlessui-state="open"]) {
  transition: width 400ms ease-in-out,
  max-width 400ms ease-in-out,
  left 400ms ease-in-out,
  right 400ms ease-in-out !important;
}

/* When expanded, override to fullscreen */
:deep(.crouton-slideover-expanded [data-headlessui-state="open"]) {
  left: 0 !important;
  right: 0 !important;
  width: 100vw !important;
  max-width: none !important;
}

/* Expanded body gets more padding */
:deep(.crouton-slideover-expanded .p-4) {
  padding: 1.5rem !important;
}
</style>
