<script setup lang="ts">
/**
 * Kitchen Display (KDS) Block — public renderer (#61, decoupled KDS).
 *
 * Drop-on-a-page kitchen screen for an iPad. It is NOT a printer: it reads the
 * event's orders directly and shows one ticket per (order × location), so the
 * kitchen screen and the bar screen each see only their items and bump them
 * independently. "Done" lives in `salesKdsbumps`; bumping never touches the
 * print queue or the order's status.
 *
 * The editor fixes the event by slug and (optionally) which locations this
 * screen shows; we resolve the slug to an id via the public by-slug endpoint,
 * then poll the feed scoped to those locations. clientOnly — BlockContent wraps
 * us in <ClientOnly>; no top-level await, so no Suspense boundary is needed.
 */
interface KitchenDisplayAttrs {
  eventSlug?: string
  /** Locations this screen shows; empty/absent = every location in the event. */
  locations?: string[]
}

interface KdsItem { title: string, quantity: number, remarks?: string | null }
interface KdsJob {
  id: string
  orderId: string
  locationId: string
  orderNumber: string
  clientName: string | null
  isPersonnel: boolean
  createdAt: string
  items: KdsItem[]
}

const props = defineProps<{ attrs: KitchenDisplayAttrs }>()

const { t } = useT()
const route = useRoute()

const eventSlug = computed(() => props.attrs.eventSlug || '')
const teamParam = computed(() => String(route.params.team || ''))

const eventId = ref<string | null>(null)
const eventNotFound = ref(false)
const jobs = ref<KdsJob[]>([])

// Optimistically hide a job the moment it's bumped, so the tile leaves
// immediately instead of waiting for the next poll. The queue is the real
// source of truth — the next refresh confirms it's gone.
const bumping = ref<Set<string>>(new Set())

async function resolveEvent() {
  if (!eventSlug.value || !teamParam.value) return
  try {
    const ev = await $fetch<{ id: string }>(
      `/api/crouton-sales/events/${teamParam.value}/by-slug/${eventSlug.value}`
    )
    eventId.value = ev.id
  }
  catch {
    eventNotFound.value = true
  }
}

// Locations this screen shows, as a query param; empty = the whole event.
const locationsParam = computed(() => (props.attrs.locations || []).filter(Boolean).join(','))

async function refresh() {
  if (!eventId.value) return
  try {
    const res = await $fetch<{ jobs: KdsJob[] }>(
      `/api/crouton-sales/events/${eventId.value}/display-jobs`,
      { query: locationsParam.value ? { locations: locationsParam.value } : undefined }
    )
    jobs.value = res.jobs
  }
  catch {
    // Transient blip — keep the last board until the next poll.
  }
}

async function bump(job: KdsJob) {
  if (!eventId.value) return
  bumping.value = new Set([...bumping.value, job.id])
  try {
    await $fetch(`/api/crouton-sales/events/${eventId.value}/kds-bump`, {
      method: 'POST',
      body: { orderId: job.orderId, locationId: job.locationId }
    })
    await refresh()
  }
  catch {
    // Bump failed — show the tile again so it can be retried.
    const next = new Set(bumping.value)
    next.delete(job.id)
    bumping.value = next
  }
}

const active = computed(() => jobs.value.filter(j => !bumping.value.has(j.id)))

// Poll every 2s; pause when the tab is hidden.
let timer: ReturnType<typeof setInterval> | null = null
function tick() { if (document.visibilityState !== 'hidden') refresh() }

onMounted(async () => {
  await resolveEvent()
  await refresh()
  timer = setInterval(tick, 2000)
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
function ago(iso: string) {
  const s = Math.max(0, Math.floor((now.value - new Date(iso).getTime()) / 1000))
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  return `${m}m ${s % 60}s`
}
</script>

<template>
  <div class="kitchen-display-block">
    <!-- Editor didn't pick an event -->
    <UAlert
      v-if="!eventSlug"
      color="neutral"
      variant="soft"
      icon="i-lucide-monitor"
      :title="t('sales.block.noEventPicked')"
    />

    <!-- Picked event no longer resolves (deleted / stale slug) -->
    <UAlert
      v-else-if="eventNotFound"
      color="neutral"
      variant="soft"
      icon="i-lucide-monitor-x"
      :title="t('sales.blocks.kitchenDisplay.ui.eventNotFound')"
    />

    <!-- The board — theme-driven via Nuxt UI semantic tokens (follows dark mode) -->
    <UCard>
      <header class="flex items-center justify-between mb-5">
        <div class="flex items-center gap-3">
          <UIcon name="i-lucide-chef-hat" class="size-6 text-primary" />
          <h2 class="text-xl font-bold tracking-tight text-highlighted">{{ t('sales.blocks.kitchenDisplay.ui.title') }}</h2>
        </div>
        <div class="flex items-center gap-2 text-sm text-muted">
          <span class="inline-block size-2 rounded-full bg-success animate-pulse" />
          {{ t('sales.blocks.kitchenDisplay.ui.live') }} · {{ t('sales.blocks.kitchenDisplay.ui.active', { count: active.length }) }}
        </div>
      </header>

      <div v-if="active.length === 0" class="flex flex-col items-center justify-center text-center text-dimmed py-32">
        <UIcon name="i-lucide-check-check" class="size-12 mb-3 text-success" />
        <p class="text-lg">{{ t('sales.blocks.kitchenDisplay.ui.allCaughtUp') }}</p>
      </div>

      <TransitionGroup
        name="order"
        tag="div"
        class="grid gap-4 [grid-template-columns:repeat(auto-fill,minmax(260px,1fr))]"
      >
        <div
          v-for="o in active"
          :key="o.id"
          class="rounded-2xl bg-muted ring ring-default shadow-sm overflow-hidden flex flex-col"
          :class="o.isPersonnel ? 'ring-warning/60' : ''"
        >
          <div
            class="flex items-center justify-between px-4 py-3 border-b border-default"
            :class="o.isPersonnel ? 'bg-warning/10' : 'bg-elevated/60'"
          >
            <div class="flex items-baseline gap-2">
              <span class="text-2xl font-extrabold text-highlighted">#{{ o.orderNumber }}</span>
              <UBadge v-if="o.isPersonnel" color="warning" variant="subtle" size="sm" class="font-bold uppercase">{{ t('sales.blocks.kitchenDisplay.ui.staff') }}</UBadge>
            </div>
            <span class="text-xs text-muted tabular-nums">{{ ago(o.createdAt) }}</span>
          </div>

          <div class="px-4 py-3 flex-1">
            <p v-if="o.clientName" class="text-sm text-muted mb-2">{{ o.clientName }}</p>
            <ul class="space-y-1.5">
              <li v-for="(it, i) in o.items" :key="i" class="flex gap-2 text-[15px] text-default">
                <span class="font-bold text-primary tabular-nums min-w-[1.5rem]">{{ it.quantity }}×</span>
                <span class="flex-1">
                  {{ it.title }}
                  <span v-if="it.remarks" class="block text-xs text-warning">↳ {{ it.remarks }}</span>
                </span>
              </li>
            </ul>
          </div>

          <UButton
            color="success"
            size="lg"
            block
            icon="i-lucide-check"
            :label="t('sales.blocks.kitchenDisplay.ui.bump')"
            class="rounded-none font-bold uppercase tracking-wide"
            @click="bump(o)"
          />
        </div>
      </TransitionGroup>
    </UCard>
  </div>
</template>

<style scoped>
.order-enter-active, .order-leave-active { transition: all .35s ease; }
.order-enter-from { opacity: 0; transform: translateY(-10px) scale(.97); }
.order-leave-to { opacity: 0; transform: scale(.92); }
</style>
