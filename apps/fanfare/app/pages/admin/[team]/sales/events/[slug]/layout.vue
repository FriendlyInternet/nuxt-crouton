<script setup lang="ts">
/**
 * Event Workspace — driven by the LAYOUT ENGINE (#711 test).
 *
 * Same surface as the hand-coded workspace (EventWorkspace/Shell.vue: a
 * horizontal splitter of POS / Orders / Clients), but expressed as a layout
 * *data tree* and rendered by <CroutonLayoutRenderer>. Each leaf resolves to a
 * sales layout block (`sales-pos` / `sales-orders` / `sales-clients`) via the
 * allowlisted `croutonLayoutBlocks` registry; the event slug is passed as each
 * block's config. The proportions (45 / 30 / 25) mirror Shell's SplitterPanel
 * default-sizes, and the blocks' declared minWidths keep the panes viable.
 *
 * This is the proof that the layout engine can reproduce a real production
 * surface from data — the evidence the #711 AI gate asks for.
 *
 * @route /admin/[team]/sales/events/[slug]/layout
 */
import type { LayoutTree } from '@fyit/crouton-core/app/types/layout'

definePageMeta({ middleware: ['auth'] })

const { t } = useT()
const route = useRoute()

const teamSlug = computed(() => String(route.params.team || ''))
const eventSlug = computed(() => String(route.params.slug || ''))
const workspacePath = computed(() => `/admin/${teamSlug.value}/sales/events/${eventSlug.value}`)

// The layout tree — the same three panes as Shell.vue, but as data. The leaf
// `defaultSize`s mirror Shell's SplitterPanel default-sizes (pos 45, orders 30,
// clients 25); CroutonLayoutRenderer maps the split → reka-ui SplitterGroup and
// enforces each block's declared minWidth.
const tree = computed<LayoutTree>(() => ({
  renderer: 'panes',
  root: {
    type: 'split',
    direction: 'horizontal',
    children: [
      { type: 'leaf', blockId: 'sales-pos', defaultSize: 45, config: { eventSlug: eventSlug.value } },
      { type: 'leaf', blockId: 'sales-orders', defaultSize: 30, config: { eventSlug: eventSlug.value } },
      { type: 'leaf', blockId: 'sales-clients', defaultSize: 25, config: { eventSlug: eventSlug.value } },
    ],
  },
}))
</script>

<template>
  <div class="p-6 space-y-4">
    <div class="flex items-center gap-2">
      <UButton
        icon="i-lucide-arrow-left"
        color="neutral"
        variant="ghost"
        size="sm"
        :label="t('sales.events.workspace')"
        :to="workspacePath"
      />
      <UBadge color="neutral" variant="subtle" icon="i-lucide-layout-dashboard">
        Layout engine
      </UBadge>
    </div>

    <!-- Same frame + height as Shell's kassa container. -->
    <div class="border border-default rounded-xl overflow-clip bg-default h-[calc(100dvh-12rem)] min-h-[28rem]">
      <CroutonLayoutRenderer :node="tree.root" />
    </div>
  </div>
</template>
