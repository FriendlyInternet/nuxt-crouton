<script setup lang="ts">
/**
 * Clients panel: lists the event's active clients with their open tab
 * (order count + total), searchable. "Print receipt" settles the tab — it
 * queues one aggregated end-of-tab receipt and deactivates the client,
 * removing them from the POS picker. Only meaningful for events in
 * recurring-clients mode (`requiresClient`).
 *
 * Rendered by the workspace Shell as a side pane beside the POS (the
 * "Klanten" vertical tab / header button) — the Shell owns the pane header
 * and close button; this component is just the pane body. It mounts fresh
 * on every open (v-if), so loading happens in onMounted.
 */
import type { SalesEvent } from '../../../collections/events/types'

const props = defineProps<{
  event: SalesEvent
}>()

const { t } = useT()
const toast = useNotify()
const nuxtApp = useNuxtApp()
const { format: formatPrice } = useSalesCurrency(() => props.event.currency)

interface ClientTabSummary {
  id: string
  title: string
  orderCount: number
  total: number
}

interface ClientTabLine {
  name: string
  quantity: number
  price: number
  optionLabels: string[]
  total: number
}

const search = ref('')
const clients = ref<ClientTabSummary[]>([])
const pending = ref(false)
// Two-step print: first click arms the row, second click confirms.
const armedId = ref<string | null>(null)
const printingId = ref<string | null>(null)

// Expand a row to preview the aggregated receipt — the same lines the
// end-of-tab receipt prints (from the `tab` GET, which shares the
// aggregation with `end-receipt`). Fetched lazily on first expand,
// cached per client.
const expandedIds = ref<Set<string>>(new Set())
const tabLines = ref<Record<string, ClientTabLine[] | undefined>>({})

function toggleExpand(id: string) {
  const next = new Set(expandedIds.value)
  if (next.has(id)) {
    next.delete(id)
  }
  else {
    next.add(id)
    if (!tabLines.value[id]) loadTab(id)
  }
  expandedIds.value = next
}

async function loadTab(clientId: string) {
  try {
    const res = await $fetch<{ lines: ClientTabLine[] }>(`${apiBase.value}/${clientId}/tab`)
    tabLines.value = { ...tabLines.value, [clientId]: res.lines }
  }
  catch (error) {
    console.error('Failed to load client tab:', error)
    toast.add({
      title: t('sales.workspace.clientsPanel.loadError'),
      color: 'error',
      icon: 'i-lucide-alert-circle'
    })
  }
}

const apiBase = computed(() =>
  `/api/crouton-sales/teams/${props.event.teamId}/events/${props.event.id}/clients`
)

async function refresh() {
  pending.value = true
  try {
    const res = await $fetch<{ clients: ClientTabSummary[] }>(`${apiBase.value}/summary`)
    clients.value = res.clients
  }
  catch (error) {
    console.error('Failed to load client tabs:', error)
    toast.add({
      title: t('sales.workspace.clientsPanel.loadError'),
      color: 'error',
      icon: 'i-lucide-alert-circle'
    })
  }
  finally {
    pending.value = false
  }
}

onMounted(refresh)

// The kassa sits right beside this pane: a checkout emits a salesOrders
// mutation (usePosOrder), so refresh the tabs live and refetch the receipt
// preview of any expanded row instead of waiting for a remount.
const unhookMutation = nuxtApp.hook('crouton:mutation', (payload: any) => {
  if (payload.collection !== 'salesOrders') return
  refresh()
  tabLines.value = {}
  for (const id of expandedIds.value) loadTab(id)
})
onUnmounted(unhookMutation)

const filteredClients = computed(() => {
  const query = search.value.trim().toLowerCase()
  if (!query) return clients.value
  return clients.value.filter(c => c.title.toLowerCase().includes(query))
})

async function printEndReceipt(client: ClientTabSummary) {
  if (armedId.value !== client.id) {
    armedId.value = client.id
    return
  }

  printingId.value = client.id
  try {
    await $fetch(`${apiBase.value}/${client.id}/end-receipt`, { method: 'POST' })
    clients.value = clients.value.filter(c => c.id !== client.id)
    // end-receipt deactivates the client server-side; emit the mutation so
    // the POS picker (order-data in Pos/Panel.vue) drops it without a reload.
    await nuxtApp.hooks.callHook('crouton:mutation', {
      operation: 'update',
      collection: 'salesClients',
      itemId: client.id,
      data: { isActive: false },
      result: null,
      correlationId: `end-receipt-${client.id}`,
      timestamp: Date.now()
    })
    toast.add({
      title: t('sales.workspace.clientsPanel.printed', { client: client.title }),
      color: 'success',
      icon: 'i-lucide-printer'
    })
  }
  catch (error) {
    console.error('Failed to print end receipt:', error)
    toast.add({
      title: t('sales.workspace.clientsPanel.printError'),
      color: 'error',
      icon: 'i-lucide-alert-circle'
    })
  }
  finally {
    printingId.value = null
    armedId.value = null
  }
}
</script>

<template>
  <div class="space-y-3">
    <UInput
      v-model="search"
      icon="i-lucide-search"
      :placeholder="t('sales.workspace.clientsPanel.searchPlaceholder')"
      class="w-full"
    />

    <div v-if="pending" class="p-6 text-center text-muted">
      {{ t('sales.common.loading') }}
    </div>

    <div v-else-if="filteredClients.length === 0" class="p-6 text-center text-muted text-sm">
      {{ search ? t('sales.workspace.clientsPanel.noMatches') : t('sales.workspace.clientsPanel.empty') }}
    </div>

    <ul v-else class="divide-y divide-default border border-default rounded-lg overflow-hidden">
      <li
        v-for="client in filteredClients"
        :key="client.id"
        class="bg-default"
      >
        <div
          class="group relative overflow-hidden hover:bg-elevated/50 transition-colors cursor-pointer"
          @click="toggleExpand(client.id)"
        >
          <!-- Expand chevron slides in from the left edge — same affordance
               as the orders-pane rows. -->
          <div
            class="absolute left-0 top-0 bottom-0 z-10 flex items-center ps-3
                   transition-transform duration-200 ease-out"
            :class="expandedIds.has(client.id) ? 'translate-x-0' : '-translate-x-full group-hover:translate-x-0 pointer-coarse:translate-x-0'"
          >
            <UIcon
              name="i-lucide-chevron-right"
              class="shrink-0 text-dimmed transition-transform"
              :class="expandedIds.has(client.id) ? 'rotate-90' : ''"
            />
          </div>

          <div
            class="flex items-center gap-3 px-3 py-2.5"
            :class="expandedIds.has(client.id) ? 'ps-9' : 'group-hover:ps-9 pointer-coarse:ps-9'"
          >
            <div class="flex-1 min-w-0">
              <p class="font-medium truncate">{{ client.title }}</p>
              <p class="text-xs text-muted">
                {{ t('sales.workspace.clientsPanel.orderCount', { count: client.orderCount }) }}
                · {{ formatPrice(client.total) }}
              </p>
            </div>
            <UButton
              size="xs"
              icon="i-lucide-printer"
              :color="armedId === client.id ? 'warning' : 'neutral'"
              :variant="armedId === client.id ? 'solid' : 'soft'"
              :loading="printingId === client.id"
              @click.stop="printEndReceipt(client)"
            >
              {{ armedId === client.id
                ? t('sales.workspace.clientsPanel.confirmPrint')
                : t('sales.workspace.clientsPanel.printReceipt') }}
            </UButton>
          </div>
        </div>

        <!-- Aggregated receipt preview: what the end-of-tab receipt prints.
             Same line styling as the expanded order (OrderItems.vue). -->
        <div v-if="expandedIds.has(client.id)" class="bg-elevated/30 px-4 pt-1 pb-4">
          <div v-if="!tabLines[client.id]" class="py-2 text-sm text-muted">
            {{ t('sales.common.loading') }}
          </div>
          <template v-else>
            <ul class="divide-y divide-default/60">
              <li
                v-for="(line, i) in tabLines[client.id] || []"
                :key="i"
                class="flex items-start gap-3 py-2 text-sm"
              >
                <span class="shrink-0 tabular-nums font-medium text-muted w-8">{{ line.quantity }}×</span>
                <div class="min-w-0 flex-1">
                  <span class="font-medium">{{ line.name }}</span>
                  <p v-for="(label, j) in line.optionLabels" :key="j" class="text-xs text-muted truncate">
                    {{ label }}
                  </p>
                </div>
                <span class="shrink-0 tabular-nums">{{ formatPrice(line.total) }}</span>
              </li>
            </ul>
            <div class="flex items-center justify-between border-t border-default mt-2 pt-2 text-sm font-semibold">
              <span>{{ t('sales.orders.total') }}</span>
              <span class="tabular-nums">{{ formatPrice(client.total) }}</span>
            </div>
          </template>
        </div>
      </li>
    </ul>
  </div>
</template>
