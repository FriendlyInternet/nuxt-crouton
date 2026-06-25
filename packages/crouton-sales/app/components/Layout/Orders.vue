<script setup lang="ts">
/**
 * Layout-block wrapper: the Orders pane as a placeable pane.
 *
 * Reproduces the `orders` SplitterPanel of EventWorkspace/Shell.vue (the
 * "Bestellingen" pane: h-14 header with the filters toggle + chip, then the
 * live OrdersTab), driven from a layout data tree (`croutonLayoutBlocks` id
 * `sales-orders`) rendered by CroutonLayoutRenderer — the #711 test.
 *
 * Team-scoped: the orders come from team-scoped admin endpoints, so it gates on
 * `loggedIn` and resolves the event by slug member-side via
 * SalesBlocksEventResolver (top-level await ⇒ wrapped in <Suspense>, which also
 * waits for the async-setup OrdersTab). The renderer passes only the declared
 * `eventSlug` config through. Filters state is local to the pane.
 */
const props = defineProps<{ eventSlug?: string }>()

const { t } = useT()
const { loggedIn } = useAuth()

const eventSlug = computed(() => props.eventSlug || '')

// Lifted here so the header hosts the filters toggle (next to the chip) while
// the selects live inside OrdersTab — same split as Shell's orders pane header.
const filtersOpen = ref(false)
const filterCount = ref(0)
</script>

<template>
  <div class="flex flex-col h-full min-h-0">
    <div class="h-14 shrink-0 flex items-center justify-between gap-2 px-3 bg-elevated/60 border-b border-default">
      <span class="flex items-center gap-1.5 text-sm font-medium">
        <UIcon name="i-lucide-clipboard-list" class="size-4 shrink-0 text-muted" />
        {{ t('sales.orders.title') }}
      </span>
      <UChip v-if="loggedIn" :show="filterCount > 0" :text="filterCount" size="xl" inset>
        <UButton
          icon="i-lucide-filter"
          size="xs"
          color="neutral"
          :variant="filtersOpen ? 'soft' : 'ghost'"
          :aria-label="t('sales.workspace.filters')"
          @click="filtersOpen = !filtersOpen"
        />
      </UChip>
    </div>

    <div class="flex-1 overflow-y-auto p-4 pt-2">
      <!-- Team-members-only: anonymous visitors don't see orders. -->
      <div
        v-if="!loggedIn"
        class="p-6 text-center text-sm text-muted"
      >
        <UIcon name="i-lucide-lock" class="w-6 h-6 mx-auto mb-2 text-muted" />
        {{ t('sales.blocks.salesOrders.ui.teamOnly') }}
      </div>

      <Suspense v-else>
        <SalesBlocksEventResolver
          v-slot="{ event }"
          :event-slug="eventSlug"
          :not-found-label="t('sales.blocks.salesOrders.ui.eventNotFound')"
        >
          <SalesEventWorkspaceOrdersTab
            v-model:filters-open="filtersOpen"
            :event="event"
            @update:active-filter-count="filterCount = $event"
          />
        </SalesBlocksEventResolver>
        <template #fallback>
          <div class="p-6 text-center text-muted">{{ t('sales.common.loading') }}</div>
        </template>
      </Suspense>
    </div>
  </div>
</template>
