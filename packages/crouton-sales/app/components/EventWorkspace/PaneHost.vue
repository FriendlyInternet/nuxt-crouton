<script setup lang="ts">
/**
 * Standalone pane host — deep entry without the kassa.
 *
 * The launcher cards open ONE workspace pane (orders / clients / data /
 * settings) as its own fullscreen surface. Mounting the whole Shell for that
 * would boot the POS (product queries, splitters, cart) invisibly behind the
 * pane just to throw it away on close — this host mounts only the requested
 * pane, with the same h-14 header its slideover twin has in the Shell
 * (orders filter chip, settings Opslaan, close ✕).
 *
 * Async setup (event lookup) — hosts wrap it in <Suspense>.
 */
import type { Ref } from 'vue'
import type { SalesEvent } from '~~/layers/sales/collections/events/types'

const props = defineProps<{
  eventSlug: string
  pane: 'orders' | 'clients' | 'data' | 'settings'
  /** Team route param override — defaults to route.params.team. */
  teamParam?: string
}>()

const emit = defineEmits<{ close: [] }>()

const { t } = useT()
const route = useRoute()
const teamParam = computed(() => props.teamParam || (route.params.team as string))

const { items: events } = await useCollectionQuery('salesEvents')
const event = computed(() =>
  (events.value as SalesEvent[] | null)?.find(e => e.slug === props.eventSlug)
)

const meta = computed(() => ({
  orders: { icon: 'i-lucide-clipboard-list', title: t('sales.orders.title') },
  clients: { icon: 'i-lucide-users', title: t('sales.workspace.clientsPanel.title') },
  data: { icon: 'i-lucide-chart-line', title: t('sales.workspace.dataPanel.title') },
  settings: { icon: 'i-lucide-settings', title: t('sales.events.settings') }
}[props.pane]))

// Orders filters — same state lift as the Shell (toggle in the header,
// selects inside OrdersTab, count feeds the chip).
const ordersFiltersOpen = ref(false)
const ordersFilterCount = ref(0)

// Data filters (#2186): the same funnel the Shell's data pane got in #2147 —
// selects live in DataPanel, the toggle lives in this pane's header, the count
// feeds the chip. PaneHost never had it, so a deep-entry Data card on narrow
// screens had no way to filter; this brings it to parity with the orders pane.
const dataFiltersOpen = ref(false)
const dataFilterCount = ref(0)

// Settings save API — handed up by SettingsTab once its async setup resolves
// (#1321). The Save lives in a fixed FOOTER below the scroll area, so a long
// settings tab scrolls cleanly above it.
const settingsTab = shallowRef<{ save: () => Promise<void>, dirty: Ref<boolean>, saving: Ref<boolean> } | null>(null)
const settingsDirty = computed(() => settingsTab.value?.dirty.value ?? false)
const settingsSaving = computed(() => settingsTab.value?.saving.value ?? false)

</script>

<template>
  <div class="flex flex-col h-full min-h-0">
    <div v-if="!event" class="flex-1 flex items-center justify-center text-muted">
      {{ t('sales.events.eventNotFound') }}
    </div>

    <template v-else>
      <SalesEventWorkspacePaneHeader :icon="meta.icon" :title="meta.title" @close="emit('close')">
        <UChip
          v-if="pane === 'orders'"
          :show="ordersFilterCount > 0"
          :text="ordersFilterCount"
          size="xl"
          inset
        >
          <UButton
            icon="i-lucide-filter"
            size="xs"
            color="neutral"
            :variant="ordersFiltersOpen ? 'soft' : 'ghost'"
            :aria-label="t('sales.workspace.filters')"
            @click="ordersFiltersOpen = !ordersFiltersOpen"
          />
        </UChip>
        <UChip
          v-else-if="pane === 'data'"
          :show="dataFilterCount > 0"
          :text="dataFilterCount"
          size="xl"
          inset
        >
          <UButton
            icon="i-lucide-filter"
            size="xs"
            color="neutral"
            :variant="dataFiltersOpen ? 'soft' : 'ghost'"
            :aria-label="t('sales.workspace.filters')"
            @click="dataFiltersOpen = !dataFiltersOpen"
          />
        </UChip>
      </SalesEventWorkspacePaneHeader>

      <div class="flex-1 overflow-y-auto p-4 pt-2">
        <SalesEventWorkspaceOrdersPaneBody
          v-if="pane === 'orders'"
          v-model:filters-open="ordersFiltersOpen"
          :event="event"
          @update:active-filter-count="ordersFilterCount = $event"
        />

        <SalesEventWorkspaceClientsPanel v-else-if="pane === 'clients'" :event="event" />

        <SalesEventWorkspaceDataPanel
          v-else-if="pane === 'data'"
          v-model:filters-open="dataFiltersOpen"
          :event="event"
          :team-param="teamParam"
          @update:active-filter-count="dataFilterCount = $event"
        />

        <Suspense v-else-if="pane === 'settings'">
          <SalesEventWorkspaceSettingsTab :event="event" hide-save-bar tabbed @register="settingsTab = $event" />
          <template #fallback>
            <div class="p-6 text-center text-muted">{{ t('sales.common.loading') }}</div>
          </template>
        </Suspense>
      </div>

      <!-- Settings Save: a fixed footer outside the scroll area (content
           scrolls above it, never behind). -->
      <SalesEventWorkspaceSettingsSaveBar
          class="px-4"
        v-if="pane === 'settings'"
        :dirty="settingsDirty"
        :saving="settingsSaving"
        @save="settingsTab?.save()"
      />
    </template>
  </div>
</template>
