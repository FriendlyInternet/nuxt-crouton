<script setup lang="ts">
/**
 * Per-event print-flow picker (#1324) — which transport delivers this event's
 * thermal print jobs. Deliberately dumb: crouton-printing has no auth/routes,
 * so the embedding domain surface (e.g. the sales printers tab) fetches and
 * persists via its own team-authed endpoint and just binds this component.
 *
 * `transport: null` = no choice recorded yet (legacy: both transports allowed).
 * The heartbeat props render the liveness readout ("spooler last seen 4s ago")
 * from print_transports.lastSpoolerPollAt / lastDrainerTickAt.
 */
import { useTimeAgo, useTimestamp } from '@vueuse/core'

export interface TransportPickerItem {
  value: 'local-drainer' | 'router-spooler' | 'none'
  label: string
  description: string
}

const props = defineProps<{
  /** 'local-drainer' | 'router-spooler' | 'none' | null (null = not set, legacy) */
  transport: string | null
  lastSpoolerPollAt?: string | null
  lastDrainerTickAt?: string | null
  loading?: boolean
  /** Override the option labels/descriptions (this package ships no i18n —
   *  the embedding domain passes its own translated strings). */
  items?: TransportPickerItem[]
  unsetTitle?: string
  unsetDescription?: string
  lastSeenLabel?: string
  neverSeenLabel?: string
}>()

const emit = defineEmits<{
  'update:transport': [value: 'local-drainer' | 'router-spooler' | 'none']
}>()

const defaultItems: TransportPickerItem[] = [
  {
    value: 'local-drainer',
    label: 'Local drainer',
    description: 'A device at the venue (Pi / mini-PC) runs the app and prints straight to the printers — works fully offline.'
  },
  {
    value: 'router-spooler',
    label: 'Router spooler',
    description: 'The on-site router polls the cloud app over HTTPS and prints on the local network.'
  },
  {
    value: 'none',
    label: 'Paused',
    description: 'Nobody prints — jobs queue up as pending until a flow is chosen.'
  }
]

const pickerItems = computed(() => props.items ?? defaultItems)
const itemLabel = (value: string) => pickerItems.value.find(i => i.value === value)?.label ?? value

type TransportValue = TransportPickerItem['value']

// URadioGroup wants the union (or undefined for "nothing selected" — the
// legacy/unset state); null from the API maps onto undefined here.
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
// anything under ~90s counts as alive. useTimestamp keeps "ago" + the dot
// fresh while the tab stays open.
const now = useTimestamp({ interval: 5_000 })
const spoolerAgo = useTimeAgo(() => props.lastSpoolerPollAt ?? 0)
const drainerAgo = useTimeAgo(() => props.lastDrainerTickAt ?? 0)
const ALIVE_MS = 90_000
const isAlive = (iso?: string | null) => !!iso && now.value - Date.parse(iso) < ALIVE_MS

const heartbeats = computed(() => [
  { label: itemLabel('local-drainer'), iso: props.lastDrainerTickAt, ago: drainerAgo.value },
  { label: itemLabel('router-spooler'), iso: props.lastSpoolerPollAt, ago: spoolerAgo.value }
])
</script>

<template>
  <div class="space-y-4">
    <UAlert
      v-if="transport === null"
      color="warning"
      variant="subtle"
      icon="i-lucide-circle-help"
      :title="unsetTitle ?? 'No print flow chosen for this event'"
      :description="unsetDescription ?? 'Both transports are currently allowed (legacy behaviour). Pick one below to make it exclusive.'"
    />

    <URadioGroup
      v-model="selected"
      :items="pickerItems"
      :disabled="loading"
      value-key="value"
      variant="card"
    />

    <ul class="space-y-1">
      <li
        v-for="hb in heartbeats"
        :key="hb.label"
        class="flex items-center gap-2 text-xs text-muted"
      >
        <span
          class="inline-block size-2 rounded-full transition-colors"
          :class="isAlive(hb.iso) ? 'bg-success' : 'bg-neutral-300 dark:bg-neutral-700'"
        />
        <span class="font-medium">{{ hb.label }}</span>
        <span v-if="hb.iso">{{ lastSeenLabel ?? 'last seen' }} {{ hb.ago }}</span>
        <span v-else>{{ neverSeenLabel ?? 'never seen' }}</span>
      </li>
    </ul>
  </div>
</template>
