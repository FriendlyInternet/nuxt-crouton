<script setup lang="ts">
/**
 * Launcher cards — the member's entry hub on the kassa block.
 *
 * One card per workspace surface (orders / clients / data / settings), each
 * with a one-line explanation and a live headline number, replacing the old
 * cramped button strip. Tapping a card deep-opens the fullscreen kassa on
 * that pane (the block passes the pane to Shell's initialPane).
 *
 * Stats are best-effort: fetched client-side on mount, one cheap call per
 * card, and a failed call just leaves the number as "—" — the cards must
 * never block or break the launcher.
 */
const props = defineProps<{ eventSlug: string }>()

const emit = defineEmits<{ open: [pane: 'orders' | 'clients' | 'data' | 'settings'] }>()

const { t } = useT()
const { getTeamId } = useTeamContext()

interface EventRow { id: string, slug: string, currency?: string, requiresClient?: boolean }

const event = ref<EventRow | null>(null)
const ordersTotal = ref<number | null>(null)
const activeClients = ref<number | null>(null)
const revenue = ref<number | null>(null)
const printerCount = ref<number | null>(null)

onMounted(async () => {
  const teamId = getTeamId()
  if (!teamId || !props.eventSlug) return

  try {
    const events = await $fetch<EventRow[]>(`/api/teams/${teamId}/sales-events`)
    event.value = events.find(e => e.slug === props.eventSlug) ?? null
  } catch { return }
  if (!event.value) return
  const eventId = event.value.id

  // Independent, tolerant fetches — each failure only blanks its own number.
  $fetch<{ total: number }>(`/api/teams/${teamId}/sales-orders`, {
    query: { eventId, page: 1, pageSize: 1 }
  }).then((r) => { ordersTotal.value = r.total ?? null }).catch(() => {})

  if (event.value.requiresClient) {
    $fetch<{ isActive?: boolean }[]>(`/api/teams/${teamId}/sales-clients`)
      .then((r) => { activeClients.value = r.filter(c => c.isActive !== false).length }).catch(() => {})
  }

  $fetch<{ items?: { revenue?: number }[] }>(`/api/crouton-sales/teams/${teamId}/charts/revenue-by-day`, {
    query: { eventId }
  }).then((r) => {
    revenue.value = (r.items ?? []).reduce((s, d) => s + (Number(d.revenue) || 0), 0)
  }).catch(() => {})

  $fetch<unknown[]>(`/api/teams/${teamId}/sales-printers`, { query: { eventId } })
    .then((r) => { printerCount.value = r.length }).catch(() => {})
})

const { format: formatPrice } = useSalesCurrency(() => event.value?.currency)

function num(v: number | null): string {
  return v === null ? '—' : String(v)
}

const cards = computed(() => {
  const list = [
    {
      pane: 'orders' as const,
      icon: 'i-lucide-clipboard-list',
      title: t('sales.orders.title'),
      desc: t('sales.workspace.launcher.ordersDesc', 'All orders for this event — status, tickets, reprints'),
      stat: num(ordersTotal.value),
      statLabel: t('sales.workspace.launcher.ordersStat', 'orders')
    },
    ...(event.value?.requiresClient
      ? [{
          pane: 'clients' as const,
          icon: 'i-lucide-users',
          title: t('sales.workspace.clientsPanel.title'),
          desc: t('sales.workspace.launcher.clientsDesc', 'Open client tabs and end-of-tab receipts'),
          stat: num(activeClients.value),
          statLabel: t('sales.workspace.launcher.clientsStat', 'open tabs')
        }]
      : []),
    {
      pane: 'data' as const,
      icon: 'i-lucide-chart-line',
      title: t('sales.workspace.dataPanel.title'),
      desc: t('sales.workspace.launcher.dataDesc', 'Live sales numbers, charts and the product table'),
      stat: revenue.value === null ? '—' : formatPrice(revenue.value),
      statLabel: t('sales.workspace.launcher.dataStat', 'revenue')
    },
    {
      pane: 'settings' as const,
      icon: 'i-lucide-settings',
      title: t('sales.events.settings'),
      desc: t('sales.workspace.launcher.settingsDesc', 'Event details, printers, receipt text and helpers'),
      stat: num(printerCount.value),
      statLabel: t('sales.workspace.launcher.settingsStat', 'printers')
    }
  ]
  return list
})
</script>

<template>
  <div class="w-full flex flex-col gap-3">
    <button
      v-for="c in cards"
      :key="c.pane"
      type="button"
      class="w-full flex items-start gap-3.5 rounded-2xl border border-default bg-elevated/40 p-4 text-start transition-colors hover:bg-elevated active:bg-elevated"
      @click="emit('open', c.pane)"
    >
      <div class="size-10 shrink-0 rounded-xl bg-primary/10 text-primary flex items-center justify-center mt-0.5">
        <UIcon :name="c.icon" class="size-5" />
      </div>
      <div class="min-w-0 flex-1">
        <p class="font-semibold leading-5">{{ c.title }}</p>
        <p class="mt-1 text-xs text-muted leading-snug line-clamp-2">{{ c.desc }}</p>
      </div>
      <div class="shrink-0 text-end mt-0.5">
        <p class="text-lg font-semibold tabular-nums leading-5">{{ c.stat }}</p>
        <p class="mt-0.5 text-[10px] uppercase tracking-wide text-muted">{{ c.statLabel }}</p>
      </div>
    </button>
  </div>
</template>
