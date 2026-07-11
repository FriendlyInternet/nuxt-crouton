<script setup lang="ts">
import type { Ref, ComputedRef } from 'vue'
import type { SalesEvent } from '~~/layers/sales/collections/events/types'

const props = defineProps<{
  event: SalesEvent
  /** Hide the internal save row — the host renders its own Save button
   *  driven by the API handed up via the `register` emit (Shell's header row). */
  hideSaveBar?: boolean
  /** Render the three cards as tabbed sections instead of a grid — for the
   *  narrow-mode slideover, where a single long scroll buries Printers and
   *  Helpers. All sections stay mounted (v-show), so the one dirty/save API
   *  keeps covering fields on every tab. */
  tabbed?: boolean
}>()

const emit = defineEmits<{
  /** Hands the panel's save API to the host once async setup has resolved.
   *  A template ref can't carry this: the ref binds before an async-setup
   *  component's defineExpose attaches, so the host would read the bare
   *  public proxy forever (#1321). Emitted with null on unmount. */
  register: [api: { save: () => Promise<void>, dirty: ComputedRef<boolean>, saving: Ref<boolean> } | null]
}>()

const { t } = useT()
const route = useRoute()
const teamParam = computed(() => route.params.team as string)

const eventQuery = computed(() => ({ eventId: props.event.id }))
// Locations are only fetched for the printer subtitles — the Categories and
// Locations management cards are gone (categories are edited inline in the
// kassa; both keep their team-level admin pages).
const { items: locations } = await useCollectionQuery('salesLocations', { query: eventQuery })
const { items: printers, pending: printersPending } = await useCollectionQuery('salesPrinters', { query: eventQuery })

const locationRows = computed(() => ((locations.value as any[] | null) || []))

// Printer online LEDs. The spooler pre-flight-checks the printer (DLE EOT) on
// every print job, so the most recent job's outcome is the last-known online
// state — there is no separate ping.
interface PrintJobRow {
  id: string
  printerId: string
  status?: string | number
  createdAt?: string | number
  completedAt?: string | number
}

const { data: printJobs, refresh: refreshPrintJobs } = await useFetch<PrintJobRow[]>(
  () => `/api/crouton-sales/teams/${teamParam.value}/events/${props.event.id}/printqueues/status`,
  { default: () => [] }
)

function jobTime(job: PrintJobRow) {
  const v = job.completedAt ?? job.createdAt
  return v ? new Date(v).getTime() : 0
}

const lastJobByPrinter = computed(() => {
  const map = new Map<string, PrintJobRow>()
  for (const job of (printJobs.value || [])) {
    const prev = map.get(job.printerId)
    if (!prev || jobTime(job) >= jobTime(prev)) map.set(job.printerId, job)
  }
  return map
})

function printerLed(printerId: string) {
  const job = lastJobByPrinter.value.get(printerId)
  if (!job) {
    return { class: 'bg-accented', label: t('sales.workspace.printerUnknown', 'Not checked yet — no prints') }
  }
  switch (String(job.status ?? '0')) {
    case '2': return { class: 'bg-success', label: t('sales.workspace.printerOnline', 'Online at last print') }
    case '9': return { class: 'bg-error', label: t('sales.workspace.printerOffline', 'Offline — last print failed') }
    default: return { class: 'bg-warning animate-pulse', label: t('sales.printQueue.statusPrinting', 'Printing') }
  }
}

const printerRows = computed(() =>
  (((printers.value as any[] | null) || [])).map(p => ({
    ...p,
    led: printerLed(p.id),
    subtitle: [
      locationRows.value.find(l => l.id === p.locationId)?.title,
      p.isActive === false ? t('sales.common.inactive') : undefined
    ].filter(Boolean).join(' · ') || undefined
  }))
)

// Requeue failed/stuck print jobs (moved from the removed Printers tab).
const notify = useNotify()
const resending = ref(false)
async function resendFailedJobs() {
  resending.value = true
  try {
    const res = await $fetch<{ requeued: number }>(
      `/api/crouton-sales/teams/${teamParam.value}/events/${props.event.id}/printqueues/retry-failed`,
      { method: 'POST' }
    )
    if (res.requeued > 0) {
      notify.success(t('sales.printQueue.resendQueued', { params: { count: res.requeued }, fallback: `Requeued ${res.requeued} print job(s)` }))
      await refreshPrintJobs()
    }
    else {
      notify.info(t('sales.printQueue.resendNone', 'No failed print jobs to resend'))
    }
  }
  catch {
    notify.error(t('sales.printQueue.resendError', 'Could not requeue print jobs'))
  }
  finally {
    resending.value = false
  }
}

// Inline-editable event fields (title / currency / client switch / helper
// PIN) plus the receipt text settings — one form, one Save button for the
// whole panel. Slug is intentionally excluded — it is the route param and
// editing it here would break the current URL.
// The client switch mirrors the POS gate: OrderInterface only shows the
// client selector when requiresClient is truthy. Clients are always the
// reusable kind; there is no free-text mode.
const currencyOptions = [
  { label: t('sales.workspace.currencyEur'), value: 'EUR' },
  { label: t('sales.workspace.currencyUsd'), value: 'USD' }
]

const eventForm = ref({
  title: props.event.title || '',
  currency: props.event.currency || 'EUR',
  requiresClient: !!props.event.requiresClient,
  helperPin: props.event.helperPin || ''
})

// Receipt text settings live in the printers card (they only matter when
// printing) but save through the same panel-wide Save button.
interface ReceiptSettings {
  special_instructions_title: string
  staff_order_header: string
  footer_text: string
}

const receiptEndpoint = computed(() =>
  `/api/crouton-sales/teams/${teamParam.value}/events/${props.event.id}/receipt-settings`
)
const { data: receiptSaved } = await useFetch<ReceiptSettings>(receiptEndpoint, {
  default: () => ({
    special_instructions_title: 'SPECIAL INSTRUCTIONS:',
    staff_order_header: '*** STAFF ORDER ***',
    footer_text: 'Thank you for your order!'
  })
})
const receiptForm = ref<ReceiptSettings>({ ...receiptSaved.value })
watch(receiptSaved, (v) => { receiptForm.value = { ...v } })

// Re-seed the form when the event changes (switching events, or an external
// edit via the top-right "Edit" button).
watch(() => props.event.id, () => {
  eventForm.value = {
    title: props.event.title || '',
    currency: props.event.currency || 'EUR',
    requiresClient: !!props.event.requiresClient,
    helperPin: props.event.helperPin || ''
  }
})

const eventDirty = computed(() =>
  eventForm.value.title !== (props.event.title || '')
  || eventForm.value.currency !== (props.event.currency || 'EUR')
  || eventForm.value.requiresClient !== !!props.event.requiresClient
  || eventForm.value.helperPin !== (props.event.helperPin || '')
)

const receiptDirty = computed(() =>
  receiptForm.value.special_instructions_title !== receiptSaved.value.special_instructions_title
  || receiptForm.value.staff_order_header !== receiptSaved.value.staff_order_header
  || receiptForm.value.footer_text !== receiptSaved.value.footer_text
)

const dirty = computed(() => eventDirty.value || receiptDirty.value)
const saving = ref(false)

async function saveSettings() {
  saving.value = true
  try {
    const tasks: Promise<unknown>[] = []
    if (eventDirty.value) {
      const { update } = useCollectionMutation('salesEvents')
      tasks.push(update(props.event.id, {
        title: eventForm.value.title,
        currency: eventForm.value.currency,
        requiresClient: eventForm.value.requiresClient,
        helperPin: eventForm.value.helperPin || undefined
      }))
    }
    if (receiptDirty.value) {
      tasks.push(
        $fetch(receiptEndpoint.value, { method: 'PUT', body: receiptForm.value })
          .then(() => { receiptSaved.value = { ...receiptForm.value } })
      )
    }
    await Promise.all(tasks)
    notify.success(t('sales.workspace.settingsSaved'))
  }
  catch {
    notify.error(t('sales.receipt.saveFailed'))
  }
  finally {
    saving.value = false
  }
}

// Let the Shell host the Save button in its header row (hideSaveBar).
emit('register', { save: saveSettings, dirty, saving })
onUnmounted(() => emit('register', null))

// Tabbed mode (narrow slideover): which card is showing.
const sections = computed(() => [
  { key: 'event', label: t('sales.workspace.eventDetails'), icon: 'i-lucide-ticket' },
  { key: 'printers', label: t('sales.sidebar.printers'), icon: 'i-lucide-printer' },
  { key: 'helpers', label: t('sales.workspace.activeHelpers'), icon: 'i-lucide-users' }
])
const activeSection = ref('event')

// Per-event print flow (#1324): which transport delivers this event's thermal
// jobs — the venue device's in-process drainer, the router spooler, or nobody.
// The setting lives in crouton-printing (print_transports); this is its authed
// UI. Instant-apply like the requeue button — an operational switch, not a
// form field, so it deliberately doesn't ride the panel's Save.
interface PrintTransportState {
  transport: string
  lastSpoolerPollAt: string | null
  lastDrainerTickAt: string | null
}

const printTransportEndpoint = computed(() =>
  `/api/crouton-sales/teams/${teamParam.value}/events/${props.event.id}/print-transport`
)
// The GET resolves the no-row default ('router-spooler'), so transport is
// always a concrete value.
const { data: printTransport, refresh: refreshPrintTransport } = await useFetch<PrintTransportState>(printTransportEndpoint, {
  default: () => ({ transport: 'router-spooler', lastSpoolerPollAt: null, lastDrainerTickAt: null })
})
const printTransportSaving = ref(false)

// Keep the liveness readout honest while the panel is open: heartbeats are
// stamped at most every 30s, so a light 10s poll is plenty.
let printTransportPoll: ReturnType<typeof setInterval> | null = null
onMounted(() => {
  printTransportPoll = setInterval(() => { refreshPrintTransport() }, 10000)
})
onUnmounted(() => {
  if (printTransportPoll) clearInterval(printTransportPoll)
})

async function setPrintTransport(transport: 'local-drainer' | 'router-spooler' | 'none') {
  printTransportSaving.value = true
  try {
    await $fetch(printTransportEndpoint.value, { method: 'PUT', body: { transport } })
    await refreshPrintTransport()
    notify.success(t('sales.printFlow.updated', 'Print flow updated'))
  }
  catch {
    notify.error(t('sales.printFlow.updateError', 'Could not update the print flow'))
  }
  finally {
    printTransportSaving.value = false
  }
}

const printTransportItems = computed(() => [
  {
    value: 'local-drainer' as const,
    label: t('sales.printFlow.localDrainer', 'Local device'),
    description: t('sales.printFlow.localDrainerHelp', 'A device at the venue (Pi / mini-PC) runs the app and prints straight to the printers — works fully offline.')
  },
  {
    value: 'router-spooler' as const,
    label: t('sales.printFlow.routerSpooler', 'Via the venue router'),
    description: t('sales.printFlow.routerSpoolerHelp', 'The on-site router fetches print jobs from the cloud app and sends them to the printers.')
  },
  {
    value: 'none' as const,
    label: t('sales.printFlow.paused', 'No physical printing'),
    description: t('sales.printFlow.pausedHelp', 'No print jobs are created — orders simply appear on screen.')
  }
])

// Per-flow setup guide (#1364) — the in-app answer to "how do I set up at a
// new venue?". The checklists MIRROR crouton-printing/print-server/README.md
// (Install/Configuration): when either changes, update the other. The copyable
// values are the app-known ones (this event's id for the router's EVENT_ID,
// the app origin for API_URL, the secret's env var NAME — never its value).
const appOrigin = useRequestURL().origin
const printTransportSetup = computed(() => [
  {
    value: 'router-spooler' as const,
    intro: t('sales.printFlow.setup.routerIntro', 'One-time: image the router (API_URL in /etc/init.d/print_server). After that it introduces itself — a new event needs nothing on the router.'),
    steps: [
      {
        text: t('sales.printFlow.setup.routerPrinters', 'Put the printers on the router\'s own network with a static IP, and add each one under Printers with that IP and port 9100.')
      },
      {
        text: t('sales.printFlow.setup.routerTicket', 'The router prints its own pairing ticket (on start, until it is paired). No ticket? Check power, printer, and that API_URL points at this app:'),
        value: appOrigin,
        valueLabel: 'API_URL'
      },
      {
        text: t('sales.printFlow.setup.routerClaim', 'Enter the ticket\'s Router-ID and code below under "Pair router".')
      },
      {
        text: t('sales.printFlow.setup.routerLegacy', 'Older router without a pairing ticket? Follow the EVENT_ID steps in print-server/README.md.')
      },
      {
        text: t('sales.printFlow.setup.routerVerify', 'Done when this dot turns green — the router polls within ~30 seconds.'),
        verify: true
      }
    ]
  },
  {
    value: 'local-drainer' as const,
    intro: t('sales.printFlow.setup.drainerIntro', 'A device at the venue (Pi / mini-PC) runs the app and prints straight to the printers — automatically, no router config and nothing to enable.'),
    steps: [
      {
        text: t('sales.printFlow.setup.drainerPrinters', 'Add each printer under Printers with its LAN IP and port 9100 — the device must reach the printers on its network.')
      },
      {
        text: t('sales.printFlow.setup.drainerFlip', 'Keep this Print flow on "Local device" — the router flow is the default, and the device prints for itself only for events set to Local device.')
      },
      {
        text: t('sales.printFlow.setup.drainerVerify', 'Done when this dot turns green — the device ticks within ~30 seconds.'),
        verify: true
      },
      {
        text: t('sales.printFlow.setup.drainerOverride', 'Advanced: the app prints locally by default on a venue device. Force it on anywhere, or disable it on a device that must not print, with the env override:'),
        value: 'CROUTON_PRINTING_DRAINER=1'
      }
    ]
  }
])

// Event-level actions (moved out of the workspace header to declutter it).
// Same useCollectionQuery cache as the Shell, so refresh() updates its list
// before navigating to the duplicated event's slug.
const router = useRouter()
const { refresh: refreshEvents } = await useCollectionQuery('salesEvents')

const duplicating = ref(false)
async function duplicateEvent() {
  duplicating.value = true
  try {
    const response = await $fetch<{ slug?: string }>(
      `/api/crouton-sales/teams/${teamParam.value}/events/${props.event.id}/duplicate`,
      { method: 'POST' }
    )
    if (response?.slug) {
      await refreshEvents()
      router.push(`/admin/${teamParam.value}/sales/events/${response.slug}`)
    }
  }
  finally {
    duplicating.value = false
  }
}

// The pill's arm→confirm replaces the delete overlay; the Shell's
// crouton:mutation hook navigates back to the events list once the delete lands.
const deletingEvent = ref(false)
async function deleteEvent() {
  deletingEvent.value = true
  try {
    const { deleteItems } = useCollectionMutation('salesEvents')
    await deleteItems([props.event.id])
  }
  finally {
    deletingEvent.value = false
  }
}

// Active helpers card (scoped tokens, not a collection)
interface ActiveHelper {
  id: string
  displayName: string
  role: string
  expiresAt: string
  lastActiveAt: string | null
}

const { data: activeHelpers, pending: activeHelpersPending, refresh: refreshActiveHelpers } = await useFetch<ActiveHelper[]>(
  () => `/api/crouton-sales/teams/${teamParam.value}/events/${props.event.id}/active-helpers`,
  { default: () => [] }
)

// 24h clock, day/month only when the token outlives today — matches jobTime().
function helperExpiry(value: string): string {
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return ''
  const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })
  return d.toDateString() === new Date().toDateString()
    ? time
    : `${d.toLocaleDateString([], { day: 'numeric', month: 'numeric' })} ${time}`
}
</script>

<template>
  <div class="space-y-4">
    <!-- One Save for the whole panel: event fields + receipt text. -->
    <div v-if="!hideSaveBar" class="flex items-center justify-end gap-3">
      <span v-if="dirty" class="text-sm text-muted">{{ t('sales.workspace.unsavedChanges') }}</span>
      <UButton
        :loading="saving"
        :disabled="!dirty"
        @click="saveSettings"
      >
        {{ t('sales.common.save') }}
      </UButton>
    </div>

    <!-- Tabbed mode: segmented strip picks the visible card (same styling as
         the Shell's narrow tab strip). -->
    <div v-if="tabbed" class="flex items-center rounded-lg bg-elevated p-1 gap-1 overflow-x-auto">
      <UButton
        v-for="s in sections"
        :key="s.key"
        :icon="s.icon"
        size="sm"
        color="neutral"
        :variant="activeSection === s.key ? 'solid' : 'ghost'"
        class="flex-1 justify-center whitespace-nowrap"
        @click="activeSection = s.key"
      >
        {{ s.label }}
      </UButton>
    </div>

    <!-- One row, three blocks: event (name + currency + client switch),
         printers (incl. receipt text), helpers (incl. PIN). Tabbed mode shows
         one at a time but keeps all mounted (v-show) so dirty state and the
         panel-wide save cover every tab. -->
    <div class="grid grid-cols-1 gap-4 items-start" :class="tabbed ? '' : 'lg:grid-cols-3'">
      <!-- Event details (inline editable) -->
      <UCard v-show="!tabbed || activeSection === 'event'">
        <template #header>
          <h3 class="font-semibold">{{ t('sales.workspace.eventDetails') }}</h3>
        </template>
        <div class="space-y-4">
          <UFormField :label="t('sales.workspace.eventName')">
            <UInput v-model="eventForm.title" class="w-full" :placeholder="t('sales.workspace.eventNamePlaceholder')" />
          </UFormField>
          <UFormField :label="t('sales.workspace.currency')">
            <USelect v-model="eventForm.currency" :items="currencyOptions" class="w-full" />
          </UFormField>

          <USeparator />

          <!-- Explained rows: label + action share the top line, the
               description gets the full card width underneath — a side
               column squeezes into one-word lines in the narrow settings
               pane. -->
          <div class="space-y-1">
            <div class="flex items-center justify-between gap-3">
              <p class="text-sm font-medium leading-5">{{ t('sales.workspace.requiresClient') }}</p>
              <USwitch
                v-model="eventForm.requiresClient"
                :aria-label="t('sales.workspace.requiresClient')"
              />
            </div>
            <p class="text-sm text-muted">{{ t('sales.workspace.requiresClientDesc') }}</p>
          </div>

          <USeparator />

          <!-- Event-level actions as explained rows (moved out of the header). -->
          <div class="space-y-1">
            <div class="flex items-center justify-between gap-3">
              <p class="text-sm font-medium leading-5">{{ t('sales.workspace.duplicateEvent') }}</p>
              <UButton
                size="xs"
                variant="outline"
                color="neutral"
                icon="i-lucide-copy"
                :loading="duplicating"
                class="shrink-0"
                @click="duplicateEvent"
              >
                {{ t('sales.events.duplicate') }}
              </UButton>
            </div>
            <p class="text-sm text-muted">{{ t('sales.workspace.duplicateEventDesc') }}</p>
          </div>

          <div class="space-y-1">
            <div class="flex items-center justify-between gap-3">
              <p class="text-sm font-medium leading-5">{{ t('sales.workspace.deleteEvent') }}</p>
              <CroutonDeleteButton
                expanded
                class="shrink-0"
                :loading="deletingEvent"
                @confirm="deleteEvent"
              />
            </div>
            <p class="text-sm text-muted">{{ t('sales.workspace.deleteEventDesc') }}</p>
          </div>
        </div>
      </UCard>

      <!-- Printers: LED per row = last-known online state (checked on print). -->
      <SalesEventWorkspaceSettingsListCard
        v-show="!tabbed || activeSection === 'printers'"
        :title="t('sales.sidebar.printers')"
        collection="salesPrinters"
        :rows="printerRows"
        :pending="printersPending"
        :empty-label="t('sales.workspace.noPrinters')"
        :create-data="{ eventId: event.id }"
      >
        <template #header-actions>
          <UButton
            size="xs"
            variant="outline"
            color="warning"
            icon="i-lucide-rotate-ccw"
            :loading="resending"
            :aria-label="t('sales.printQueue.resendFailed', 'Resend failed jobs')"
            @click="resendFailedJobs"
          />
        </template>

        <!-- Print flow (instant-apply) + receipt text settings (panel Save) -->
        <template #footer>
          <div class="space-y-4">
            <div class="space-y-1">
              <p class="text-sm font-medium leading-5">{{ t('sales.printFlow.title', 'Print flow') }}</p>
              <p class="text-sm text-muted">{{ t('sales.printFlow.description', 'Who delivers the printed tickets for this event.') }}</p>
            </div>
            <CroutonPrintingTransportPicker
              :transport="printTransport.transport"
              :last-spooler-poll-at="printTransport.lastSpoolerPollAt"
              :last-drainer-tick-at="printTransport.lastDrainerTickAt"
              :loading="printTransportSaving"
              :items="printTransportItems"
              :last-seen-label="t('sales.printFlow.lastSeen', 'last seen')"
              :never-seen-label="t('sales.printFlow.neverSeen', 'never seen')"
              :setup-guides="printTransportSetup"
              :setup-label="t('sales.printFlow.setup.toggle', 'Setup')"
              :copy-label="t('sales.printFlow.setup.copy', 'Copy')"
              :copied-label="t('sales.printFlow.setup.copied', 'Copied')"
              @update:transport="setPrintTransport"
            >
              <!-- Router self-pairing (#1366): claim form + coupled routers,
                   router flow only. Team-wide — the picker stays the only
                   per-event switch. -->
              <template #setup-extra="{ transport: selectedFlow }">
                <SalesEventWorkspaceRouterPairing
                  v-if="selectedFlow === 'router-spooler'"
                  :team-param="teamParam"
                />
              </template>
            </CroutonPrintingTransportPicker>

            <USeparator />

            <div class="space-y-1">
              <p class="text-sm font-medium leading-5">{{ t('sales.workspace.receiptSettings') }}</p>
              <p class="text-sm text-muted">{{ t('sales.receipt.customize') }}</p>
            </div>
            <UFormField :label="t('sales.receipt.specialInstructionsTitle')" :help="t('sales.receipt.specialInstructionsHelp')">
              <UInput
                v-model="receiptForm.special_instructions_title"
                class="w-full"
                size="sm"
                placeholder="SPECIAL INSTRUCTIONS:"
              />
            </UFormField>
            <UFormField :label="t('sales.receipt.staffOrderHeader')" :help="t('sales.receipt.staffOrderHeaderHelp')">
              <UInput
                v-model="receiptForm.staff_order_header"
                class="w-full"
                size="sm"
                placeholder="*** STAFF ORDER ***"
              />
            </UFormField>
            <UFormField :label="t('sales.receipt.footerText')" :help="t('sales.receipt.footerTextHelp')">
              <UTextarea
                v-model="receiptForm.footer_text"
                class="w-full"
                size="sm"
                :rows="2"
                placeholder="Thank you for your order!"
              />
            </UFormField>
          </div>
        </template>
      </SalesEventWorkspaceSettingsListCard>

      <!-- Helpers: shared login PIN + active sessions (scoped tokens, not a collection) -->
      <UCard v-show="!tabbed || activeSection === 'helpers'">
        <template #header>
          <div class="flex items-center justify-between">
            <h3 class="font-semibold">{{ t('sales.workspace.activeHelpers') }}</h3>
            <UButton
              size="xs"
              variant="ghost"
              icon="i-lucide-refresh-cw"
              :loading="activeHelpersPending"
              :aria-label="t('sales.common.refresh')"
              @click="() => refreshActiveHelpers()"
            />
          </div>
        </template>

        <UFormField :label="t('sales.workspace.helperPin')">
          <UInput
            v-model="eventForm.helperPin"
            type="text"
            :placeholder="t('sales.helperLogin.enterPin')"
            size="sm"
            :ui="{ base: 'font-mono' }"
            class="w-full"
          />
        </UFormField>

        <USeparator class="my-4" />

        <div v-if="activeHelpersPending" class="p-4 text-center text-muted text-sm">
          {{ t('sales.common.loading') }}
        </div>
        <ul v-else-if="activeHelpers && activeHelpers.length > 0" class="flex flex-col gap-1">
          <li
            v-for="h in activeHelpers"
            :key="h.id"
            class="flex items-center gap-2.5 rounded-lg bg-elevated/40 px-3 py-2"
          >
            <UIcon name="i-lucide-user" class="size-4 shrink-0 text-muted" />
            <div class="min-w-0">
              <p class="text-sm font-medium truncate">{{ h.displayName }}</p>
              <p class="text-xs text-muted">
                {{ t('sales.workspace.expires') }} {{ helperExpiry(h.expiresAt) }}
              </p>
            </div>
          </li>
        </ul>
        <div v-else class="p-4 text-center text-muted text-sm">
          {{ t('sales.workspace.noHelpers') }}
        </div>
      </UCard>
    </div>
  </div>
</template>
