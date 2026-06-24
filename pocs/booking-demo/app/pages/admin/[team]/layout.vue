<script setup lang="ts">
/**
 * booking-demo POC — overrides the core layout harness so the preview boots
 * showing the DETERMINISTIC generated layout (#709) even before anything is
 * persisted. On first load it falls back to the committed `crouton.layout.json`
 * (the tree `composeDefaultLayout` produced at generate time) and persists it to
 * `layout_configs` for the active team — so the North-Star result is visible to
 * any reviewer, in any team, without a manual seed step.
 *
 * (The normal product path seeds `layout_configs` via `crouton-seed`; that seeds
 * the `test1` team, whereas a preview's review login is its own team — hence this
 * team-agnostic fallback for the demo.)
 */
import { ref, watch, onMounted } from 'vue'
import type { LayoutTree } from '@fyit/crouton-core/app/types/layout'
import generatedDefault from '~~/crouton.layout.json'

definePageMeta({ layout: 'admin', middleware: ['auth'] })

const LAYOUT_ID = 'default'
const tree = ref<LayoutTree | null>(null)
const loading = ref(true)
const { load, save, saving } = useCroutonLayoutStore()

// Persist every edit (debounced in the store).
watch(tree, (v) => { if (v) save(LAYOUT_ID, v) })

onMounted(async () => {
  try {
    const persisted = await load(LAYOUT_ID)
    // Fall back to the generated default so the preview is never a blank canvas.
    tree.value = persisted ?? (generatedDefault.tree as LayoutTree)
  } finally {
    loading.value = false
  }
})
</script>

<template>
  <UDashboardPanel id="booking-demo-layout">
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
