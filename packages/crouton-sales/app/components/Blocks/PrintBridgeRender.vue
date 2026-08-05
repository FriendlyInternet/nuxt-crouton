<script setup lang="ts">
/**
 * Print Bridge Block — public renderer (#127, browser-print / AirPrint driver).
 *
 * The browser-side drainer for the `browser-print` output driver: a drop-on-a-
 * page screen (typically the iPad/laptop physically near the printer) that
 * polls pending tickets for the event, each pre-rendered to HTML server-side,
 * and prints them through the OS / AirPrint dialog (`window.print()` in a hidden
 * iframe). Marking a ticket printed POSTs `/done`, closing the queue row — the
 * same lifecycle + admin LEDs as the thermal path. It is NOT a printer itself;
 * it bridges the universal queue to whatever printer the OS print dialog offers.
 *
 * The editor fixes the event by slug; we resolve it to an id via the public
 * by-slug endpoint (same as SalesPosPanel/KDS), then poll the feed.
 * clientOnly — BlockContent wraps us in <ClientOnly>; no top-level await.
 */
interface PrintBridgeAttrs {
  eventSlug?: string
}

interface BridgeJob {
  id: string
  // The job's opaque domain back-reference (the orderId for sales 'order' jobs).
  refId: string | null
  stationId: string
  stationTitle: string | null
  printMode: string
  locationId: string | null
  orderNumber: string
  html: string | null
}

const props = defineProps<{ attrs: PrintBridgeAttrs }>()

const { t } = useT()
const route = useRoute()

const eventSlug = computed(() => props.attrs.eventSlug || '')
const teamParam = computed(() => String(route.params.team || ''))

const eventId = ref<string | null>(null)
const eventNotFound = ref(false)
const jobs = ref<BridgeJob[]>([])
// Jobs currently being printed/acknowledged — hidden optimistically so a slow
// callback doesn't print the same ticket twice on the next poll.
const busy = ref<Set<string>>(new Set())

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

async function refresh() {
  if (!eventId.value) return
  try {
    const res = await $fetch<{ jobs: BridgeJob[] }>(
      `/api/crouton-printing/events/${eventId.value}/browser-print-jobs`
    )
    jobs.value = res.jobs
  }
  catch {
    // Transient blip — keep the last list until the next poll.
  }
}

/** Render one ticket's HTML in a hidden iframe and open the OS print dialog. */
function printHtml(html: string): Promise<void> {
  return new Promise((resolve) => {
    const iframe = document.createElement('iframe')
    iframe.setAttribute('aria-hidden', 'true')
    iframe.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;'
    iframe.onload = () => {
      try {
        iframe.contentWindow?.focus()
        iframe.contentWindow?.print()
      }
      finally {
        // Let the dialog settle before removing the frame.
        setTimeout(() => { iframe.remove(); resolve() }, 600)
      }
    }
    document.body.appendChild(iframe)
    iframe.srcdoc = html
  })
}

async function markDone(job: BridgeJob) {
  await $fetch(`/api/crouton-printing/events/${eventId.value}/browser-print-jobs/${job.id}/done`, { method: 'POST' })
}

async function printJob(job: BridgeJob) {
  if (!eventId.value || busy.value.has(job.id)) return
  busy.value = new Set([...busy.value, job.id])
  try {
    if (!job.html) {
      // Payload couldn't be rendered server-side — fail it so it stops looping
      // and surfaces on the order (admin can reprint).
      await $fetch(`/api/crouton-printing/events/${eventId.value}/browser-print-jobs/${job.id}/fail`, {
        method: 'POST',
        body: { errorMessage: 'Ticket payload could not be rendered' }
      })
    }
    else {
      await printHtml(job.html)
      await markDone(job)
    }
    await refresh()
  }
  catch {
    // Couldn't acknowledge — show the ticket again so it can be retried.
    const next = new Set(busy.value)
    next.delete(job.id)
    busy.value = next
  }
}

async function printAll() {
  // Sequential — one print dialog at a time.
  for (const job of pending.value) {
    await printJob(job)
  }
}

const pending = computed(() => jobs.value.filter(j => !busy.value.has(j.id)))

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
</script>

<template>
  <div class="print-bridge-block">
    <!-- Editor didn't pick an event -->
    <UAlert
      v-if="!eventSlug"
      color="neutral"
      variant="soft"
      icon="i-lucide-printer"
      :title="t('sales.block.noEventPicked')"
    />

    <!-- Picked event no longer resolves -->
    <UAlert
      v-else-if="eventNotFound"
      color="neutral"
      variant="soft"
      icon="i-lucide-printer"
      :title="t('sales.blocks.printBridge.ui.eventNotFound')"
    />

    <!-- The bridge -->
    <UCard>
      <header class="flex items-center justify-between mb-4">
        <div class="flex items-center gap-2">
          <UIcon name="i-lucide-printer" class="size-5 text-primary" />
          <h1 class="text-lg font-bold tracking-tight">{{ t('sales.blocks.printBridge.ui.title') }}</h1>
          <span class="inline-block size-2 rounded-full bg-emerald-500 animate-pulse" />
        </div>
        <UButton
          v-if="pending.length > 0"
          color="primary"
          icon="i-lucide-printer"
          @click="printAll"
        >
          {{ t('sales.blocks.printBridge.ui.printAll', { count: pending.length }) }}
        </UButton>
      </header>

      <p class="text-xs text-muted mb-4">{{ t('sales.blocks.printBridge.ui.hint') }}</p>

      <div v-if="pending.length === 0" class="flex flex-col items-center justify-center text-center text-muted py-16">
        <UIcon name="i-lucide-check-check" class="size-10 mb-2 text-emerald-500" />
        <p>{{ t('sales.blocks.printBridge.ui.allPrinted') }}</p>
      </div>

      <TransitionGroup
        v-else
        name="ticket"
        tag="div"
        class="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(220px,1fr))]"
      >
        <div
          v-for="job in pending"
          :key="job.id"
          class="rounded-xl bg-default border border-default p-3 flex flex-col gap-2"
        >
          <div class="flex items-center justify-between">
            <span class="text-lg font-extrabold tabular-nums">#{{ job.orderNumber }}</span>
            <UBadge
              :color="job.printMode === 'receipt' ? 'neutral' : 'primary'"
              variant="subtle"
              size="sm"
            >
              {{ job.printMode === 'receipt' ? t('sales.blocks.printBridge.ui.receipt') : t('sales.blocks.printBridge.ui.ticket') }}
            </UBadge>
          </div>
          <p class="text-xs text-muted truncate">{{ job.stationTitle || job.stationId }}</p>
          <UButton
            block
            :color="job.html ? 'primary' : 'error'"
            :icon="job.html ? 'i-lucide-printer' : 'i-lucide-triangle-alert'"
            :variant="job.html ? 'solid' : 'soft'"
            @click="printJob(job)"
          >
            {{ job.html ? t('sales.blocks.printBridge.ui.print') : t('sales.blocks.printBridge.ui.discard') }}
          </UButton>
        </div>
      </TransitionGroup>
    </UCard>
  </div>
</template>

<style scoped>
.ticket-enter-active, .ticket-leave-active { transition: all .3s ease; }
.ticket-enter-from { opacity: 0; transform: translateY(-8px) scale(.97); }
.ticket-leave-to { opacity: 0; transform: scale(.92); }
</style>
