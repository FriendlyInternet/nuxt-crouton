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

// Settings save API — same register handshake as the Shell (#1321).
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
        <UButton
          v-if="pane === 'settings'"
          size="xs"
          :loading="settingsSaving"
          :disabled="!settingsDirty"
          @click="settingsTab?.save()"
        >
          {{ t('sales.common.save') }}
        </UButton>
      </SalesEventWorkspacePaneHeader>

      <div class="flex-1 overflow-y-auto p-4 pt-2">
        <Suspense v-if="pane === 'orders'">
          <SalesEventWorkspaceOrdersTab
            v-model:filters-open="ordersFiltersOpen"
            :event="event"
            @update:active-filter-count="ordersFilterCount = $event"
          />
          <template #fallback>
            <div class="p-6 text-center text-muted">{{ t('sales.common.loading') }}</div>
          </template>
        </Suspense>

        <SalesEventWorkspaceClientsPanel v-else-if="pane === 'clients'" :event="event" />

        <SalesEventWorkspaceDataPanel v-else-if="pane === 'data'" :event="event" :team-param="teamParam" />

        <Suspense v-else-if="pane === 'settings'">
          <SalesEventWorkspaceSettingsTab :event="event" hide-save-bar tabbed @register="settingsTab = $event" />
          <template #fallback>
            <div class="p-6 text-center text-muted">{{ t('sales.common.loading') }}</div>
          </template>
        </Suspense>
      </div>
    </template>
  </div>
</template>
