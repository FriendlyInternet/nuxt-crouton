<script setup lang="ts">
/**
 * One copyable value inside a setup checklist step (#1364): a mono chip with
 * an optional VAR= label prefix and a copy button. Copying grabs the bare
 * value — the label prefix is display-only. Owns its own clipboard state so
 * each chip's "copied" check is independent.
 */
import { useClipboard } from '@vueuse/core'

const props = defineProps<{
  /** Renders nothing when absent — steps without a copyable value stay text-only. */
  value?: string
  /** Short mono label naming what the value is (e.g. "EVENT_ID"). */
  valueLabel?: string
  copyLabel?: string
  copiedLabel?: string
}>()

const { copy, copied } = useClipboard({ legacy: true, copiedDuring: 2000 })

const icon = computed(() => copied.value ? 'i-lucide-check' : 'i-lucide-copy')
const ariaLabel = computed(() =>
  copied.value ? (props.copiedLabel ?? 'Copied') : (props.copyLabel ?? 'Copy')
)
</script>

<template>
  <div v-if="value" class="flex items-center gap-1.5">
    <code class="min-w-0 max-w-full truncate rounded-md bg-accented px-2 py-1 font-mono text-xs">
      <span v-if="valueLabel" class="text-muted">{{ valueLabel }}=</span>{{ value }}
    </code>
    <UButton
      size="xs"
      variant="ghost"
      color="neutral"
      :icon="icon"
      :aria-label="ariaLabel"
      @click="copy(value!)"
    />
  </div>
</template>
