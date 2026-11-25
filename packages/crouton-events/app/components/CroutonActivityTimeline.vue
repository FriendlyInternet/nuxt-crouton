<script setup lang="ts">
import { useNow } from '@vueuse/core'
import type { CroutonEvent, EventOperation } from '../types/events'

const props = withDefaults(defineProps<{
  events: CroutonEvent[]
  loading?: boolean
  emptyMessage?: string
}>(), {
  events: () => [],
  loading: false,
  emptyMessage: undefined
})

const emit = defineEmits<{
  eventClick: [event: CroutonEvent]
}>()

const { t, locale } = useI18n()
const appConfig = useAppConfig()

// Re-render relative times every minute
const now = useNow({ interval: 60_000 })

const OPERATION_STYLE: Record<EventOperation, { icon: string, indicator: string }> = {
  create: { icon: 'i-lucide-plus', indicator: 'bg-success text-inverted' },
  update: { icon: 'i-lucide-pencil', indicator: 'bg-info text-inverted' },
  delete: { icon: 'i-lucide-trash-2', indicator: 'bg-error text-inverted' }
}

const items = computed(() => [...(props.events || [])]
  .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
  .map((event) => {
    const style = OPERATION_STYLE[event.operation] ?? { icon: 'i-lucide-circle', indicator: '' }
    const label = eventCollectionLabel(event.collectionName, appConfig.croutonCollections as Record<string, any> | undefined, t)
    const itemTitle = eventItemTitle(event)
    const action = t(`events.operation.${event.operation}`)
    const who = t('events.log.byUser', { action, name: event.userName || t('events.log.unknownUser') })
    const fieldCount = event.operation === 'update' ? (event.changes?.length || 0) : 0
    return {
      value: event.id,
      event,
      icon: style.icon,
      title: itemTitle ? `${label} · ${itemTitle}` : label,
      description: fieldCount ? `${who} · ${t('events.log.fieldsChanged', fieldCount)}` : who,
      relative: formatRelativeTime(event.timestamp, now.value, locale.value),
      full: new Date(event.timestamp).toLocaleString(locale.value),
      class: 'cursor-pointer',
      ui: { indicator: style.indicator }
    }
  }))

function onSelect(_e: Event, item: { event?: CroutonEvent }) {
  if (item.event) emit('eventClick', item.event)
}
</script>

<template>
  <div class="crouton-activity-timeline">
    <div
      v-if="loading && !events?.length"
      class="flex flex-col gap-4"
    >
      <div
        v-for="n in 4"
        :key="n"
        class="flex items-center gap-3"
      >
        <USkeleton class="size-8 rounded-full" />
        <div class="flex-1 flex flex-col gap-2">
          <USkeleton class="h-4 w-1/3" />
          <USkeleton class="h-3 w-1/2" />
        </div>
      </div>
    </div>

    <UEmpty
      v-else-if="!events?.length"
      icon="i-lucide-activity"
      :title="emptyMessage || t('events.log.empty')"
      variant="naked"
    />

    <UTimeline
      v-else
      :items="items"
      size="sm"
      @select="onSelect"
    >
      <template #date="{ item }">
        <UTooltip :text="item.full">
          <span>{{ item.relative }}</span>
        </UTooltip>
      </template>
    </UTimeline>
  </div>
</template>
