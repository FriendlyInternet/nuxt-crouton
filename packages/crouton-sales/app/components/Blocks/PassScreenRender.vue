<script setup lang="ts">
/**
 * Pass Screen Block — public renderer (#1762, epic #1755).
 *
 * The second stage of the KDS loop. Stations clear their own tickets on the
 * kitchen display; this board shows only orders where EVERY station has
 * finished, and one tap records that the assembled order reached the customer.
 *
 * Deliberately one tile per ORDER, not per (order × location) — unlike the KDS,
 * the runner carries the whole order out, so every line belongs on one tile.
 *
 * The editor fixes the event by slug (no location filter: a pass is not a
 * station, it sees the whole event). clientOnly — BlockContent wraps us in
 * <ClientOnly>; no top-level await, so no Suspense boundary is needed.
 */
// The tile owns the shape it renders; the board just fetches and lays them out.
import type { PassTileJob as PassJob } from './PassScreenTile.vue'

interface PassScreenAttrs {
  eventSlug?: string
}

const props = defineProps<{ attrs: PassScreenAttrs }>()

const { t } = useT()

const eventSlug = computed(() => props.attrs.eventSlug || '')
const { eventId, notFound: eventNotFound, resolve: resolveEvent } = useBlockEvent(eventSlug)

const jobs = ref<PassJob[]>([])

// Optimistically hide a tile the moment it's handed over, so it leaves
// immediately instead of waiting for the next poll. The feed is the real source
// of truth — the next refresh confirms it's gone.
const handing = ref<Set<string>>(new Set())

/** When the feed last answered. Drives the staleness indicator (#1766). */
const lastOkAt = ref<number | null>(null)

async function refresh() {
  if (!eventId.value) return
  try {
    const res = await $fetch<{ jobs: PassJob[] }>(
      `/api/crouton-sales/events/${eventId.value}/pass-jobs`
    )
    jobs.value = res.jobs
    lastOkAt.value = Date.now()
  }
  catch {
    // Keep the last board — one dropped poll is transient. `lastOkAt`
    // deliberately does NOT advance, so a feed that stays broken stops
    // presenting itself as live (#1766).
  }
}

async function handOver(job: PassJob) {
  if (!eventId.value) return
  handing.value = new Set([...handing.value, job.orderId])
  try {
    await $fetch(`/api/crouton-sales/events/${eventId.value}/handover`, {
      method: 'POST',
      body: { orderId: job.orderId }
    })
    await refresh()
  }
  catch {
    // Failed — show the tile again so it can be retried.
    const next = new Set(handing.value)
    next.delete(job.orderId)
    handing.value = next
  }
}

const active = computed(() => jobs.value.filter(j => !handing.value.has(j.orderId)))

// Poll every 2s; pause when the tab is hidden.
const POLL_MS = 2000
let timer: ReturnType<typeof setInterval> | null = null
function tick() { if (document.visibilityState !== 'hidden') refresh() }

onMounted(async () => {
  await resolveEvent()
  await refresh()
  timer = setInterval(tick, POLL_MS)
  document.addEventListener('visibilitychange', tick)
})
onUnmounted(() => {
  if (timer) clearInterval(timer)
  document.removeEventListener('visibilitychange', tick)
})

// Relative "Xs / Xm Ys" age, ticking once a second.
const now = ref(Date.now())
onMounted(() => {
  const t2 = setInterval(() => (now.value = Date.now()), 1000)
  onUnmounted(() => clearInterval(t2))
})

const health = computed(() => boardHealth({
  now: now.value,
  lastOkAt: lastOkAt.value,
  pollMs: POLL_MS
}))

// Health presentation, named rather than inlined as template branches.
const healthLabel = computed(() => t(`sales.blocks.passScreen.ui.${health.value}`))
const healthTextClass = computed(() => (health.value === 'stale' ? 'text-warning' : 'text-muted'))
const healthDotClass = computed(() => ({
  live: 'bg-success animate-pulse',
  stale: 'bg-warning',
  connecting: 'bg-muted animate-pulse'
}[health.value]))

function ago(iso: string) {
  const s = Math.max(0, Math.floor((now.value - new Date(iso).getTime()) / 1000))
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  return `${m}m ${s % 60}s`
}
</script>

<template>
  <div class="pass-screen-block">
    <!-- Editor didn't pick an event -->
    <UAlert
      v-if="!eventSlug"
      color="neutral"
      variant="soft"
      icon="i-lucide-hand-platter"
      :title="t('sales.block.noEventPicked')"
    />

    <!-- Picked event no longer resolves (deleted / stale slug) -->
    <UAlert
      v-else-if="eventNotFound"
      color="neutral"
      variant="soft"
      icon="i-lucide-monitor-x"
      :title="t('sales.blocks.passScreen.ui.eventNotFound')"
    />

    <UCard>
      <header class="flex items-center justify-between mb-5">
        <div class="flex items-center gap-3">
          <UIcon name="i-lucide-hand-platter" class="size-6 text-primary" />
          <h2 class="text-xl font-bold tracking-tight text-highlighted">{{ t('sales.blocks.passScreen.ui.title') }}</h2>
        </div>
        <div class="flex items-center gap-2 text-sm" :class="healthTextClass">
          <span class="inline-block size-2 rounded-full" :class="healthDotClass" />
          {{ healthLabel }} · {{ t('sales.blocks.passScreen.ui.ready', { count: active.length }) }}
        </div>
      </header>

      <!-- A frozen board is worse than an empty one (#1766). -->
      <UAlert
        v-if="health === 'stale'"
        color="warning"
        variant="subtle"
        icon="i-lucide-wifi-off"
        class="mb-4"
        :title="t('sales.blocks.passScreen.ui.stale')"
        :description="t('sales.blocks.passScreen.ui.staleHint')"
      />

      <div v-if="active.length === 0" class="flex flex-col items-center justify-center text-center text-dimmed py-32">
        <UIcon name="i-lucide-check-check" class="size-12 mb-3 text-success" />
        <p class="text-lg">{{ t('sales.blocks.passScreen.ui.allHandedOut') }}</p>
      </div>

      <TransitionGroup
        name="order"
        tag="div"
        class="grid gap-4 [grid-template-columns:repeat(auto-fill,minmax(260px,1fr))]"
      >
        <SalesBlocksPassScreenTile
          v-for="o in active"
          :key="o.orderId"
          :job="o"
          :age="ago(o.createdAt)"
          @hand-over="handOver"
        />
      </TransitionGroup>
    </UCard>
  </div>
</template>

<style scoped>
.order-enter-active, .order-leave-active { transition: all .35s ease; }
.order-enter-from { opacity: 0; transform: translateY(-10px) scale(.97); }
.order-leave-to { opacity: 0; transform: scale(.92); }
</style>
