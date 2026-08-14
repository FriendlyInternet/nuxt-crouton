<script setup lang="ts">
/**
 * Admin `/order` route → the ONE unified workspace experience.
 *
 * This legacy path used to render a standalone <SalesPosPanel> — a *different*
 * kassa from the workspace block. That split is exactly what #2186 removes:
 * any link/bookmark to `/order` now lands on the IDENTICAL adaptive block the
 * workspace page (`/…/<slug>`) and the CMS pages use — desktop = the multi-pane
 * shell inline, mobile = the "Open kassa" launcher + pane-opening buttons.
 * The POS itself is still reachable: the block's own "Open kassa" opens it.
 *
 * @route /admin/[team]/sales/events/[slug]/order
 */
definePageMeta({ middleware: ['auth'] })

const route = useRoute()
const eventSlug = computed(() => String(route.params.slug || ''))
</script>

<template>
  <div class="p-6">
    <SalesBlocksEventWorkspaceRender :attrs="{ eventSlug }" />
  </div>
</template>
