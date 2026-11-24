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
const eventTeamId = ref<string | null>(null)
const eventNotFound = ref(false)
// A 401/403 from the feed or a bump: the helper token is missing, expired (8h)
// or revoked. Polling stops and the screen says so — never reloads by itself.
const signedOut = ref(false)

const { loggedIn } = useAuth()
const { loadSession, adoptScopedSession, loginAsAdmin, eventId: sessionEventId } = useHelperAuth()
const { helperHeaders } = useHelperHeaders()

function isAuthError(e: any) {
  return [401, 403].includes(e?.statusCode ?? e?.response?.status)
}

function markSignedOut() {
  signedOut.value = true
  if (timer) {
    clearInterval(timer)
    timer = null
  }
}
const jobs = ref<KdsJob[]>([])

// Optimistically hide a job the moment it's bumped, so the tile leaves
// immediately instead of waiting for the next poll. The queue is the real
// source of truth — the next refresh confirms it's gone.
const bumping = ref<Set<string>>(new Set())

// Two-step tap-to-arm-then-confirm (#2115): a single tap in a busy kitchen
// shouldn't bump an order. Tapping a resting card arms it (reveals a
// full-card confirm overlay); tapping the overlay bumps it. Tapping anywhere
// else, or letting it sit for a few seconds, disarms it again.
const armedId = ref<string | null>(null)
const justConfirmed = ref<string | null>(null)
const DISARM_MS = 4000
let disarmTimer: ReturnType<typeof setTimeout> | null = null

function clearDisarmTimer() {
  if (disarmTimer) {
    clearTimeout(disarmTimer)
    disarmTimer = null
  }
}

function arm(job: KdsJob) {
  armedId.value = job.id
  clearDisarmTimer()
  disarmTimer = setTimeout(() => {
    if (armedId.value === job.id) armedId.value = null
  }, DISARM_MS)
}

function disarm() {
  armedId.value = null
  clearDisarmTimer()
}

async function confirmBump(job: KdsJob) {
  clearDisarmTimer()
  armedId.value = null
  justConfirmed.value = job.id
  await bump(job)
  if (justConfirmed.value === job.id) justConfirmed.value = null
}

onUnmounted(() => clearDisarmTimer())

async function resolveEvent() {
  if (!eventSlug.value || !teamParam.value) return
  try {
    const ev = await $fetch<{ id: string, teamId: string }>(
      `/api/crouton-sales/events/${teamParam.value}/by-slug/${eventSlug.value}`
    )
    eventId.value = ev.id
    eventTeamId.value = ev.teamId
  }
  catch {
    eventNotFound.value = true
  }
}

// Log in like the till (Pos/Panel.vue): adopt the page gate's event session (a
// scoped page already redeemed the helper PIN), else a signed-in team member
// mints an admin helper token. No match → the feed 401s → "Signed out".
async function ensureSession() {
  if (!eventId.value || !eventTeamId.value) return
  const ids = { teamId: eventTeamId.value, eventId: eventId.value }
  loadSession()
  if (sessionEventId.value !== eventId.value) adoptScopedSession(ids)
  if (sessionEventId.value !== eventId.value && loggedIn.value) await loginAsAdmin(ids)
}

// Locations this screen shows, as a query param; empty = the whole event.
const locationsParam = computed(() => (props.attrs.locations || []).filter(Boolean).join(','))

/** When the feed last answered. Drives the staleness indicator (#1766). */
const lastOkAt = ref<number | null>(null)

async function refresh() {
  if (!eventId.value || signedOut.value) return
  try {
    const res = await $fetch<{ jobs: KdsJob[] }>(
      `/api/crouton-sales/events/${eventId.value}/display-jobs`,
      {
        query: locationsParam.value ? { locations: locationsParam.value } : undefined,
        headers: helperHeaders()
      }
    )
    jobs.value = res.jobs
    lastOkAt.value = Date.now()
  }
  catch (e) {
    if (isAuthError(e)) {
      markSignedOut()
      return
    }
    // Keep the last board — a single dropped poll is genuinely transient. But
    // `lastOkAt` deliberately does NOT advance, so a feed that stays broken
    // stops presenting itself as live (#1766).
  }
}

async function bump(job: KdsJob) {
  if (!eventId.value) return
  bumping.value = new Set([...bumping.value, job.id])
  try {
    await $fetch(`/api/crouton-sales/events/${eventId.value}/kds-bump`, {
      method: 'POST',
      body: { orderId: job.orderId, locationId: job.locationId },
      headers: helperHeaders()
    })
    await refresh()
  }
  catch (e) {
    if (isAuthError(e)) markSignedOut()
    // Bump failed — show the tile again so it can be retried.
    const next = new Set(bumping.value)
    next.delete(job.id)
    bumping.value = next
  }
}

const active = computed(() => jobs.value.filter(j => !bumping.value.has(j.id)))

// Poll every 2s; pause when the tab is hidden.
const POLL_MS = 2000
let timer: ReturnType<typeof setInterval> | null = null
function tick() { if (document.visibilityState !== 'hidden') refresh() }

onMounted(async () => {
  await resolveEvent()
  if (eventId.value) await ensureSession()
  await refresh()
  if (!signedOut.value) timer = setInterval(tick, POLL_MS)
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
// Is the board still telling the truth? `now` already ticks every second, so
// this re-evaluates on its own without a second timer (#1766).
const health = computed(() => boardHealth({
  now: now.value,
  lastOkAt: lastOkAt.value,
  pollMs: POLL_MS
}))

// Header live-dot look + label per board health (#1766).
const HEALTH_UI = {
  live: { text: 'text-muted', dot: 'bg-success animate-pulse', label: 'sales.blocks.kitchenDisplay.ui.live' },
  stale: { text: 'text-warning', dot: 'bg-warning', label: 'sales.blocks.kitchenDisplay.ui.stale' },
  connecting: { text: 'text-muted', dot: 'bg-muted animate-pulse', label: 'sales.blocks.kitchenDisplay.ui.connecting' }
} as const
const healthUi = computed(() => HEALTH_UI[health.value])

// What to show instead of the board, if anything: the editor picked no event,
// the picked event no longer resolves, or the helper token is gone (#4480 —
// reload only on tap).
const notice = computed(() => {
  if (!eventSlug.value) {
    return { color: 'neutral' as const, variant: 'soft' as const, icon: 'i-lucide-monitor', title: t('sales.block.noEventPicked') }
  }
  if (eventNotFound.value) {
    return { color: 'neutral' as const, variant: 'soft' as const, icon: 'i-lucide-monitor-x', title: t('sales.blocks.kitchenDisplay.ui.eventNotFound') }
  }
  if (signedOut.value) {
    return {
      color: 'warning' as const,
      variant: 'subtle' as const,
      icon: 'i-lucide-log-out',
      title: t('sales.blocks.kitchenDisplay.ui.signedOut'),
      actions: [{ label: t('sales.blocks.kitchenDisplay.ui.signInAgain'), onClick: () => reloadNuxtApp() }]
    }
  }
  return null
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
    <!-- No event picked / event gone / signed out — one notice instead of the board -->
    <UAlert v-if="notice" v-bind="notice" />

    <!-- The board — theme-driven via Nuxt UI semantic tokens (follows dark mode) -->
    <UCard v-else>
      <header class="flex items-center justify-between mb-5">
        <div class="flex items-center gap-3">
          <UIcon name="i-lucide-chef-hat" class="size-6 text-primary" />
          <h2 class="text-xl font-bold tracking-tight text-highlighted">{{ t('sales.blocks.kitchenDisplay.ui.title') }}</h2>
        </div>
        <div class="flex items-center gap-2 text-sm" :class="healthUi.text">
          <span class="inline-block size-2 rounded-full" :class="healthUi.dot" />
          {{ t(healthUi.label) }}
          · {{ t('sales.blocks.kitchenDisplay.ui.active', { count: active.length }) }}
        </div>
      </header>

      <!--
        A frozen board is worse than an empty one: staff work from tickets that
        stopped being true. Say so loudly rather than letting the tiles imply
        they are current (#1766).
      -->
      <UAlert
        v-if="health === 'stale'"
        color="warning"
        variant="subtle"
        icon="i-lucide-wifi-off"
        class="mb-4"
        :title="t('sales.blocks.kitchenDisplay.ui.stale')"
        :description="t('sales.blocks.kitchenDisplay.ui.staleHint')"
      />

      <div v-if="active.length === 0" class="flex flex-col items-center justify-center text-center text-dimmed py-32">
        <UIcon name="i-lucide-check-check" class="size-12 mb-3 text-success" />
        <p class="text-lg">{{ t('sales.blocks.kitchenDisplay.ui.allCaughtUp') }}</p>
      </div>

      <TransitionGroup
        name="order"
        tag="div"
        class="grid gap-4 [grid-template-columns:repeat(auto-fill,minmax(260px,1fr))]"
      >
        <SalesBlocksKitchenDisplayTile
          v-for="o in active"
          :key="o.id"
          :job="o"
          :age="ago(o.createdAt)"
          :armed="armedId === o.id"
          :confirmed="justConfirmed === o.id"
          @arm="arm(o)"
          @confirm="confirmBump(o)"
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
