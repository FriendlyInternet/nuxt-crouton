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
 */
import { useTimestamp } from '@vueuse/core'

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
const now = useTimestamp({ interval: 5_000 })
const ALIVE_MS = 90_000
const isAlive = (iso?: string | null) => !!iso && now.value - Date.parse(iso) < ALIVE_MS

function shortAge(iso: string): string {
  const s = Math.max(0, Math.round((now.value - Date.parse(iso)) / 1000))
  if (s < 60) return `${s}s`
  if (s < 3600) return `${Math.floor(s / 60)}m`
  if (s < 86400) return `${Math.floor(s / 3600)}h`
  return `${Math.floor(s / 86400)}d`
}

const heartbeats = computed(() => [
  { label: itemLabel('local-drainer'), iso: props.lastDrainerTickAt },
  { label: itemLabel('router-spooler'), iso: props.lastSpoolerPollAt }
])
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
        <span v-if="hb.iso">{{ lastSeenLabel ?? 'last seen' }} {{ shortAge(hb.iso) }}</span>
        <span v-else>{{ neverSeenLabel ?? 'never seen' }}</span>
      </li>
    </ul>
  </div>
</template>
