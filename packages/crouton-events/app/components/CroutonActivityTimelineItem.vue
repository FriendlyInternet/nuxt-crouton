<script setup lang="ts">
import type { CroutonEvent } from '../types/events'

const props = defineProps<{
  event: CroutonEvent
  expanded?: boolean
}>()

const emit = defineEmits<{
  click: [event: CroutonEvent]
  toggleExpand: [event: CroutonEvent]
}>()

// Format timestamp
const formattedTime = computed(() => {
  const date = new Date(props.event.timestamp)
  return date.toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  })
})

// Operation badge config
const operationConfig = computed(() => {
  switch (props.event.operation) {
    case 'create':
      return { color: 'success' as const, icon: 'i-lucide-plus', label: 'CREATE' }
    case 'update':
      return { color: 'info' as const, icon: 'i-lucide-pencil', label: 'UPDATE' }
    case 'delete':
      return { color: 'error' as const, icon: 'i-lucide-trash-2', label: 'DELETE' }
    default:
      return { color: 'neutral' as const, icon: 'i-lucide-circle', label: 'UNKNOWN' }
  }
})

// Summarize changes
const changesSummary = computed(() => {
  const count = props.event.changes?.length || 0
  if (count === 0) return ''
  if (count === 1) return `${props.event.changes[0]?.fieldName} changed`
  return `${count} fields changed`
})

// Parse and format for inline display
function parseValue(value: string | null): string {
  return formatEventValue(parseEventValue(value))
}

</script>

<template>
  <div
    class="group relative flex gap-3 py-3 px-2 rounded-lg hover:bg-elevated/50 cursor-pointer transition-colors"
    @click="emit('click', event)"
  >
    <!-- Timeline dot -->
    <div class="flex flex-col items-center">
      <div
        class="size-3 rounded-full ring-2 ring-offset-2 ring-offset-background"
        :class="{
          'bg-green-500 ring-green-500/30': event.operation === 'create',
          'bg-blue-500 ring-blue-500/30': event.operation === 'update',
          'bg-red-500 ring-red-500/30': event.operation === 'delete'
        }"
      />
      <div class="flex-1 w-px bg-border mt-2" />
    </div>

    <!-- Content -->
    <div class="flex-1 min-w-0 space-y-2">
      <!-- Header row -->
      <div class="flex items-center gap-2 flex-wrap">
        <span class="text-sm text-muted font-mono">{{ formattedTime }}</span>

        <UBadge
          :color="operationConfig.color"
          size="xs"
          variant="subtle"
        >
          <UIcon
            :name="operationConfig.icon"
            class="size-3 mr-1"
          />
          {{ operationConfig.label }}
        </UBadge>

        <span class="font-medium text-sm">{{ event.collectionName }}</span>

        <span
          v-if="event.itemId"
          class="text-xs text-muted font-mono"
        >
          #{{ truncateValue(event.itemId, 8) }}
        </span>

        <span
          v-if="event.userName"
          class="ml-auto text-xs text-muted flex items-center gap-1"
        >
          <UIcon
            name="i-lucide-user"
            class="size-3"
          />
          {{ event.userName }}
        </span>
      </div>

      <!-- Changes summary -->
      <div
        v-if="changesSummary"
        class="text-sm text-muted"
      >
        {{ changesSummary }}
      </div>

      <!-- Expanded changes -->
      <div
        v-if="expanded && event.changes?.length"
        class="mt-2 space-y-1"
      >
        <div
          v-for="change in event.changes"
          :key="change.fieldName"
          class="text-xs bg-muted/30 rounded px-2 py-1 font-mono"
        >
          <span class="text-muted">{{ change.fieldName }}:</span>
          <span
            v-if="change.oldValue !== null"
            class="text-red-500 line-through mx-1"
          >
            {{ truncateValue(parseValue(change.oldValue), 30) }}
          </span>
          <span
            v-if="change.oldValue !== null && change.newValue !== null"
            class="text-muted mx-1"
          >→</span>
          <span
            v-if="change.newValue !== null"
            class="text-green-500"
          >
            {{ truncateValue(parseValue(change.newValue), 30) }}
          </span>
        </div>
      </div>

      <!-- Expand toggle -->
      <button
        v-if="event.changes?.length"
        class="text-xs text-primary hover:underline"
        @click.stop="emit('toggleExpand', event)"
      >
        {{ expanded ? 'Hide changes' : 'Show changes' }}
      </button>
    </div>
  </div>
</template>
