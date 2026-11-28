<script setup lang="ts">
/**
 * booking-demo POC — a list-only composed layout (#3651): one `bookings-list`
 * leaf fed by the `bookings` layout store. Shows that a block on its own, with
 * no sibling panes, still gets its data from the layout's source.
 */
import type { LayoutTree } from '@fyit/crouton-core/app/types/layout'
import { collectLayoutStores } from '@fyit/crouton-core/app/utils/layout-stores'

definePageMeta({ layout: 'admin', middleware: ['auth'] })

const tree: LayoutTree = {
  renderer: 'panes',
  root: { type: 'leaf', blockId: 'bookings-list', source: 'bookings' },
  sources: { bookings: { options: { scope: 'team' } } },
}
const stores = collectLayoutStores(tree)
</script>

<template>
  <UDashboardPanel id="booking-demo-list">
    <template #header>
      <UDashboardNavbar title="Bookings list">
        <template #leading>
          <UDashboardSidebarCollapse />
        </template>
      </UDashboardNavbar>
    </template>

    <template #body>
      <div class="h-full w-full" data-handoff="list-layout">
        <CroutonLayoutStoreScope :stores="stores">
          <CroutonLayoutRenderer :node="tree.root" />
        </CroutonLayoutStoreScope>
      </div>
    </template>
  </UDashboardPanel>
</template>
