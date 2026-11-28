<script setup lang="ts">
/**
 * booking-demo POC — the #924 "bookings-from-blocks" compose target (Phase 2).
 *
 * Where `layout.vue` boots the deterministic generated tree (`crouton.layout.json`,
 * composed from the `bookings-calendar` COMPOUND block), this page hand-assembles
 * the native calendar-primary arrangement out of the ATOMIC blocks extracted in
 * Phase 1 — `bookings-calendar-only` / `bookings-filters` / `bookings-locations` /
 * `bookings-list` — and renders it straight through the read-only
 * `CroutonLayoutRenderer`. It's the side-by-side reference for the gap report:
 * this is "can a bookings-package consumer reassemble the module from blocks?".
 *
 * Arrangement (mirrors `CroutonBookingsPanel` — calendar primary, controls rail):
 *
 *   horizontal split
 *   ├─ bookings-calendar-only        ~62%   (primary surface)
 *   └─ vertical split                ~38%   (the controls/list rail)
 *      ├─ bookings-filters           ~30%
 *      ├─ bookings-locations         ~30%
 *      └─ bookings-list              ~40%
 *
 * Cross-pane coordination (filters/locations → list) runs through the `bookings`
 * layout store (#3651): the filters, locations and list leaves name
 * `source: 'bookings'`, and one copy — created by the `CroutonLayoutStoreScope`
 * below — loads the data once and feeds all three. The calendar-only pane still
 * self-fetches and no longer follows the filters until it moves onto the store
 * (#3652, accepted on the epic branch). The renderer's intrinsic `@container` reflow + min-width auto-stacking handle the
 * responsive collapse to a single column on a phone-width pane (no authored
 * breakpoint needed) — that's what Phase 3 screenshots verify.
 */
import type { LayoutTree } from '@fyit/crouton-core/app/types/layout'
import { collectLayoutStores } from '@fyit/crouton-core/app/utils/layout-stores'

definePageMeta({ layout: 'admin', middleware: ['auth'] })

const SCOPE = { scope: 'team' } as const

useBookingCart()

// Static compose — the whole point of the test is that the arrangement is plain
// data (a `LayoutTree`), not a bespoke Vue template. Reproduces the native
// calendar-primary layout from the registered atomic blocks.
const tree: LayoutTree = {
  renderer: 'panes',
  root: {
    type: 'split',
    direction: 'horizontal',
    children: [
      {
        type: 'leaf',
        blockId: 'bookings-calendar-only',
        config: SCOPE,
        defaultSize: 62,
      },
      {
        type: 'split',
        direction: 'vertical',
        defaultSize: 38,
        children: [
          { type: 'leaf', blockId: 'bookings-filters', source: 'bookings', defaultSize: 30 },
          { type: 'leaf', blockId: 'bookings-locations', source: 'bookings', defaultSize: 30 },
          { type: 'leaf', blockId: 'bookings-list', source: 'bookings', defaultSize: 40 },
        ],
      },
    ],
  },
  sources: { bookings: { options: { scope: 'team' } } },
}
// The store copy belongs to the scope wrapper, which never remounts when the split
// stacks on a phone — so its fetches are never left ownerless and aborted (#3789).
// The calendar-only leaf's own fetch uses the same per-team useFetch key
// (`dedupe: 'defer'`), so it joins the store's request instead of starting another.
const stores = collectLayoutStores(tree)
// `?render=page` draws the same tree the way a served page does (content height,
// one scroll) instead of the admin fill — to check both modes side by side (#2560).
const route = useRoute()
const pageRender = computed(() => route.query.render === 'page')
</script>

<template>
  <UDashboardPanel id="booking-demo-blocks">
    <template #header>
      <UDashboardNavbar title="Bookings from blocks">
        <template #leading>
          <UDashboardSidebarCollapse />
        </template>
        <template #right>
          <span class="text-xs text-muted">#924 · atomic-block compose</span>
        </template>
      </UDashboardNavbar>
    </template>

    <template #body>
      <div :class="pageRender ? 'w-full' : 'h-full w-full'" data-handoff="blocks-layout">
        <CroutonLayoutStoreScope :stores="stores">
          <CroutonLayoutRenderer :node="tree.root" :interactive="!pageRender" />
        </CroutonLayoutStoreScope>
      </div>
    </template>
  </UDashboardPanel>
</template>
