<script setup lang="ts">
/**
 * Mirror freshness banner (#179, epic #175 — D1 live mirror).
 *
 * The online dashboard reads a *copy* of the venue till, so it must make the
 * mirror nature visible: this banner shows when the cloud last heard from the
 * Pi ("synced 3s ago") and flips to a stale/offline state once that clock stops
 * advancing. It polls the team-scoped sync-status endpoint, which the cloud
 * ingest stamps on every push and every idle ping from the Pi.
 *
 * Clock skew is neutralised by anchoring age to the server's clock: each fetch
 * returns `serverNow`, we capture the offset to the local clock once, and a 1s
 * ticker re-derives the relative label without re-fetching.
 *
 * Auto-imported as <SalesSyncStatus>. Mount inside a clientOnly surface (the
 * dashboard block) — it polls and uses live timers.
 */
interface SyncStatusResponse {
  lastContactAt: number | null
  lastEventAt: number | null
  lastBatchApplied: number
  /** Every till of the team, freshest first (#2725). */
  devices?: Array<{ deviceId: string, lastContactAt: number | null, lastPullAt?: number | null }>
  /** Latest config edits that lost a conflict, newest first (#816). */
  lostEdits?: Array<{
    id: string
    deviceId: string | null
    entityType: string
    entityId: string
    reason: string
    lost: Record<string, unknown>
    kept: Record<string, unknown>
    at: number
  }>
  serverNow: number
}

const props = withDefaults(defineProps<{
  teamParam: string
  /** Poll cadence for the status endpoint. */
  pollMs?: number
  /** Age beyond which the mirror is considered stale (Pi likely offline). */
  staleMs?: number
  /** Also list each till's last push/pull and the edits that lost a conflict. */
  detailed?: boolean
}>(), {
  pollMs: 5000,
  // The Pi pings at least every 30s when online; 90s = ~3 missed pings.
  staleMs: 90000,
  detailed: false,
})

const { t } = useT()
const ageLabel = useSyncAge()

const data = ref<SyncStatusResponse | null>(null)
const errored = ref(false)
/** server clock − local clock, captured each fetch (handles device skew). */
const clockOffset = ref(0)
/** ticks every second so the relative label stays live between polls. */
const nowTick = ref(Date.now())

async function fetchStatus() {
  try {
    const res = await $fetch<SyncStatusResponse>(
      `/api/crouton-sales/teams/${props.teamParam}/sync-status`,
    )
    data.value = res
    clockOffset.value = res.serverNow - Date.now()
    errored.value = false
  }
  catch {
    errored.value = true
  }
}

// Age of the last contact, in ms, against the server clock.
const ageMs = computed(() => {
  const last = data.value?.lastContactAt
  if (!last) return null
  return (nowTick.value + clockOffset.value) - last
})

type State = 'never' | 'live' | 'stale' | 'error'
const state = computed<State>(() => {
  if (errored.value && !data.value) return 'error'
  if (!data.value?.lastContactAt) return 'never'
  return (ageMs.value ?? Infinity) >= props.staleMs ? 'stale' : 'live'
})

// Compact relative label: "just now" / "12s ago" / "4m ago" / "2h ago".
function relativeLabel(ms: number | null): string {
  if (ms == null) return ''
  return ageLabel(ms)
}

// With several tills the banner shows the freshest; the rest are in the tooltip.
const deviceCount = computed(() => data.value?.devices?.length ?? 0)
const title = computed(() => {
  const lines = [ui.value.detail]
  if (deviceCount.value > 1) {
    lines.push(t('sales.sync.tillsSynced', { n: deviceCount.value }))
    for (const d of data.value!.devices!) {
      const age = d.lastContactAt ? (nowTick.value + clockOffset.value) - d.lastContactAt : null
      lines.push(`${d.deviceId.replace('device:', '').slice(0, 8)} — ${age == null ? '…' : relativeLabel(age)}`)
    }
  }
  return lines.join('\n')
})

const lostEdits = computed(() => data.value?.lostEdits ?? [])
/** Short state for the plain `detailed` line: "Live" / "Offline since 3m ago" / … */
const plainLabel = computed(() => {
  if (state.value === 'stale') return t('sales.sync.offlineSince', { ago: relativeLabel(ageMs.value) })
  if (state.value === 'never') return t('sales.sync.noTill')
  return ui.value.label
})

const ui = computed(() => {
  switch (state.value) {
    case 'live':
      return { dot: 'bg-success', pulse: true, color: 'text-success',
        label: t('sales.sync.live'), detail: t('sales.sync.syncedAgo', { ago: relativeLabel(ageMs.value) }) }
    case 'stale':
      return { dot: 'bg-warning', pulse: false, color: 'text-warning',
        label: t('sales.sync.stale'), detail: t('sales.sync.staleDetail', { ago: relativeLabel(ageMs.value) }) }
    case 'never':
      // Neutral (not a semantic status) — kept muted rather than a status token.
      return { dot: 'bg-muted', pulse: false, color: 'text-muted',
        label: t('sales.sync.waiting'), detail: t('sales.sync.waitingDetail') }
    default:
      return { dot: 'bg-error', pulse: false, color: 'text-error',
        label: t('sales.sync.unavailable'), detail: t('sales.sync.unavailableDetail') }
  }
})

onMounted(() => {
  fetchStatus()
  // Poll the endpoint, and tick a local clock every second for the label.
  useIntervalFn(fetchStatus, props.pollMs)
  useIntervalFn(() => { nowTick.value = Date.now() }, 1000)
})
</script>

<template>
  <div class="sales-sync-status-wrap space-y-3">
  <div
    v-if="detailed"
    class="sales-sync-status flex min-w-0 items-center gap-2 text-sm"
    :title="title"
  >
    <span class="size-2 shrink-0 rounded-full" :class="ui.dot" />
    <span class="truncate" :class="ui.color">{{ plainLabel }}</span>
  </div>
  <div
    v-else
    class="sales-sync-status flex w-fit max-w-full items-center gap-2.5 rounded-full border border-default bg-elevated/60 px-3.5 py-1.5 text-sm"
    :title="title"
  >
    <span class="relative flex size-2.5 shrink-0">
      <span
        v-if="ui.pulse"
        class="absolute inline-flex h-full w-full animate-ping rounded-full opacity-75"
        :class="ui.dot"
      />
      <span class="relative inline-flex size-2.5 rounded-full" :class="ui.dot" />
    </span>
    <span class="font-medium" :class="ui.color">{{ ui.label }}</span>
    <span class="text-muted truncate">{{ ui.detail }}</span>
  </div>

    <SalesSyncDetails
      v-if="detailed"
      :devices="data?.devices ?? []"
      :lost-edits="lostEdits"
      :now="nowTick + clockOffset"
      :show-empty="!!data && !errored"
    />
  </div>
</template>
