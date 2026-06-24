<script setup lang="ts">
/**
 * CroutonLayout harness (#706) — the editable panes surface end to end.
 *
 * Loads a team-scoped layout from `layout_configs`, edits it through
 * `CroutonLayout` (drag blocks from the palette into panes, resize, nest, swap,
 * configure), and saves every change back (debounced) so a reload restores the
 * arrangement. Starts empty when nothing is saved yet, so the compose loop is
 * demonstrable from scratch. Replaces the throwaway spike harness.
 */
import { ref, watch, onMounted } from 'vue'
import type { LayoutTree } from '@fyit/crouton-core/app/types/layout'

definePageMeta({ layout: 'admin', middleware: ['auth'] })

const LAYOUT_ID = 'default'

const tree = ref<LayoutTree | null>(null)
const loading = ref(true)
const { load, save, saving } = useCroutonLayoutStore()

// Persist every edit (the store debounces the flurry of drag/resize changes).
watch(tree, (v) => { if (v) save(LAYOUT_ID, v) })

onMounted(async () => {
  try {
    tree.value = await load(LAYOUT_ID)
  } finally {
    // Clear the loading overlay even if the load fails, so the empty canvas shows.
    loading.value = false
  }
})
</script>

<template>
  <UDashboardPanel id="crouton-layout">
    <template #header>
      <UDashboardNavbar title="Layout">
        <template #leading>
          <UDashboardSidebarCollapse />
        </template>
        <template #right>
          <span v-if="saving" class="text-xs text-muted">Saving…</span>
        </template>
      </UDashboardNavbar>
    </template>

    <template #body>
      <div class="relative h-full w-full">
        <!-- Loading overlay (#750) — avoids a blank-canvas flash while the saved tree loads. -->
        <div
          v-if="loading"
          class="absolute inset-0 z-20 flex flex-col items-center justify-center gap-3 bg-default/70 backdrop-blur-sm"
        >
          <UIcon name="i-lucide-loader-2" class="size-6 animate-spin text-primary" />
          <span class="text-sm text-muted">Loading layout…</span>
        </div>
        <CroutonLayout v-model="tree" />
      </div>
    </template>
  </UDashboardPanel>
</template>
