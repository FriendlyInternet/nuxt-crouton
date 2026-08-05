<script setup lang="ts">
/**
 * Per-event print-flow picker (#1324) — which transport delivers this event's
 * thermal print jobs. Deliberately dumb: crouton-printing has no auth/routes,
 * so the embedding domain surface (e.g. the sales printers tab) fetches and
 * persists via its own team-authed endpoint and just binds this component.
 * The endpoint resolves the no-row default, so `transport` always has a value.
 *
 * The heartbeat props render the liveness readout ("spooler last seen 4s ago")
 * from print_transports.lastSpoolerPollAt / lastDrainerTickAt.
 *
 * The optional setup guide (#1364) renders a collapsible per-flow checklist
 * under the picker, with app-known values (event id, app URL) ready to copy.
 * Content comes fully translated from the embedding domain; its steps must
 * mirror print-server/README.md (see the sync note there).
 */
import { useTimestamp } from '@vueuse/core'
import type { TransportSetupGuide } from '../types/transport-setup'

interface TransportPickerItem {
  value: 'local-drainer' | 'router-spooler' | 'none'
  label: string
  description: string
}

const props = defineProps<{
  /** 'local-drainer' | 'router-spooler' | 'none' */
  transport: string
  lastSpoolerPollAt?: string | null
  lastDrainerTickAt?: string | null
  loading?: boolean
  /** Override the option labels/descriptions (this package ships no i18n —
   *  the embedding domain passes its own translated strings). */
  items?: TransportPickerItem[]
  lastSeenLabel?: string
  neverSeenLabel?: string
  /** Per-flow setup checklists (#1364) — no guide for a flow means no Setup
   *  toggle while that flow is selected. Fully translated by the embedder. */
  setupGuides?: TransportSetupGuide[]
  setupLabel?: string
  copyLabel?: string
  copiedLabel?: string
}>()

const emit = defineEmits<{
  'update:transport': [value: 'local-drainer' | 'router-spooler' | 'none']
}>()

const defaultItems: TransportPickerItem[] = [
  {
    value: 'local-drainer',
    label: 'Local device',
    description: 'A device at the venue (Pi / mini-PC) runs the app and prints straight to the printers — works fully offline.'
  },
  {
    value: 'router-spooler',
    label: 'Via the venue router',
    description: 'The on-site router fetches print jobs from the cloud app and sends them to the printers.'
  },
  {
    value: 'none',
    label: 'No physical printing',
    description: 'No print jobs are created — orders simply appear on screen.'
  }
]

const pickerItems = computed(() => props.items ?? defaultItems)
const itemLabel = (value: string) => pickerItems.value.find(i => i.value === value)?.label ?? value

type TransportValue = TransportPickerItem['value']

const selected = computed<TransportValue | undefined>({
  get: () => {
    const v = props.transport
    return v === 'local-drainer' || v === 'router-spooler' || v === 'none' ? v : undefined
  },
  set: (value) => {
    if (value) emit('update:transport', value)
  }
})

// Liveness readout. Heartbeats are stamped at most every 30s (throttled), so
// anything under ~90s counts as alive. useTimestamp keeps the age + the dot
// fresh while the tab stays open. The age renders language-neutral (8s / 3m /
// 2h / 5d) — this package ships no i18n, so no locale-specific words here.
// Rows are fully precomputed so the template stays branch-free.
const now = useTimestamp({ interval: 5_000 })
const ALIVE_MS = 90_000

function shortAge(iso: string): string {
  const s = Math.max(0, Math.round((now.value - Date.parse(iso)) / 1000))
  if (s < 60) return `${s}s`
  if (s < 3600) return `${Math.floor(s / 60)}m`
  if (s < 86400) return `${Math.floor(s / 3600)}h`
  return `${Math.floor(s / 86400)}d`
}

const DOT_DEAD = 'bg-neutral-300 dark:bg-neutral-700'
const DOT_LIVE = 'bg-success'
const lastSeenText = computed(() => props.lastSeenLabel ?? 'last seen')
const neverSeenText = computed(() => props.neverSeenLabel ?? 'never seen')

function heartbeatRow(value: TransportValue, iso: string | null | undefined) {
  const label = itemLabel(value)
  if (!iso) {
    return { label, dotClass: DOT_DEAD, text: neverSeenText.value }
  }
  const alive = now.value - Date.parse(iso) < ALIVE_MS
  return { label, dotClass: alive ? DOT_LIVE : DOT_DEAD, text: `${lastSeenText.value} ${shortAge(iso)}` }
}

const heartbeats = computed(() => [
  heartbeatRow('local-drainer', props.lastDrainerTickAt),
  heartbeatRow('router-spooler', props.lastSpoolerPollAt)
])

// Setup guide (#1364): the checklist for the currently selected flow. The
// toggle only exists when that flow has a guide; open state survives flow
// switches so comparing two flows' checklists doesn't re-collapse each time.
const setupOpen = ref(false)
const activeGuide = computed(() =>
  props.setupGuides?.find(g => g.value === selected.value)
)

// The verify step carries the selected flow's live heartbeat dot — setup is
// confirmed by the same signal the readout below renders.
const verifyDotClass = computed(() => {
  const iso = selected.value === 'local-drainer' ? props.lastDrainerTickAt : props.lastSpoolerPollAt
  if (!iso) return DOT_DEAD
  return now.value - Date.parse(iso) < ALIVE_MS ? DOT_LIVE : DOT_DEAD
})
</script>

<template>
  <div class="space-y-4">
    <URadioGroup
      v-model="selected"
      :items="pickerItems"
      :disabled="loading"
      value-key="value"
      variant="card"
    />

    <UCollapsible v-if="activeGuide" v-model:open="setupOpen">
      <UButton
        variant="ghost"
        color="neutral"
        size="xs"
        icon="i-lucide-wrench"
        trailing-icon="i-lucide-chevron-down"
        :label="setupLabel ?? 'Setup'"
        :ui="{ trailingIcon: `transition-transform ${setupOpen ? 'rotate-180' : ''}` }"
        block
        class="justify-start"
      />

      <template #content>
        <CroutonPrintingTransportSetupPanel
          class="mt-2"
          :guide="activeGuide"
          :verify-dot-class="verifyDotClass"
          :copy-label="copyLabel"
          :copied-label="copiedLabel"
        />
        <!-- Domain extras under the checklist (#1366: the sales embed mounts
             its router-pairing claim form here for the router flow). -->
        <slot name="setup-extra" :transport="selected" />
      </template>
    </UCollapsible>

    <ul class="space-y-1">
      <li
        v-for="hb in heartbeats"
        :key="hb.label"
        class="flex items-center gap-2 text-xs text-muted"
      >
        <span class="inline-block size-2 rounded-full transition-colors" :class="hb.dotClass" />
        <span class="font-medium">{{ hb.label }}</span>
        <span>{{ hb.text }}</span>
      </li>
    </ul>
  </div>
</template>
