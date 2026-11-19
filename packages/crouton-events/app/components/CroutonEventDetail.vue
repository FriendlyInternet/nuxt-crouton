<script setup lang="ts">
import type { CroutonEvent } from '../types/events'

const props = defineProps<{
  modelValue: boolean
  event: CroutonEvent
}>()

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
}>()

const isOpen = computed({
  get: () => props.modelValue,
  set: value => emit('update:modelValue', value)
})

const { t, locale } = useI18n()
const appConfig = useAppConfig()

const OPERATION_BADGE = {
  create: { color: 'success' as const, icon: 'i-lucide-plus' },
  update: { color: 'info' as const, icon: 'i-lucide-pencil' },
  delete: { color: 'error' as const, icon: 'i-lucide-trash-2' }
}

const badge = computed(() => OPERATION_BADGE[props.event.operation] ?? { color: 'neutral' as const, icon: 'i-lucide-circle' })
const operationLabel = computed(() => t(`events.operation.${props.event.operation}`))
const collectionLabel = computed(() =>
  eventCollectionLabel(props.event.collectionName, appConfig.croutonCollections as Record<string, any> | undefined, t)
)
const itemTitle = computed(() => eventItemTitle(props.event))

const title = computed(() => [operationLabel.value, collectionLabel.value, itemTitle.value].filter(Boolean).join(' · '))
const relativeTime = computed(() => formatRelativeTime(props.event.timestamp, Date.now(), locale.value))
const fullDateTime = computed(() => new Date(props.event.timestamp).toLocaleString(locale.value, {
  dateStyle: 'full',
  timeStyle: 'medium'
}))

const notify = useNotify()

function copy(value: string) {
  navigator.clipboard.writeText(value)
  notify.info(t('events.detail.copied'), { target: 'toast' })
}
</script>

<template>
  <UModal
    v-model:open="isOpen"
    :title="title"
    :description="relativeTime"
    :ui="{ content: 'sm:max-w-2xl' }"
  >
    <template #body>
      <div class="flex flex-col gap-6">
        <dl class="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
          <div class="flex flex-col gap-1">
            <dt class="text-muted font-medium">
              {{ t('events.detail.action') }}
            </dt>
            <dd>
              <UBadge
                :color="badge.color"
                :icon="badge.icon"
                variant="subtle"
                :label="operationLabel"
              />
            </dd>
          </div>
          <div class="flex flex-col gap-1">
            <dt class="text-muted font-medium">
              {{ t('events.detail.when') }}
            </dt>
            <dd>{{ fullDateTime }}</dd>
          </div>
          <div class="flex flex-col gap-1">
            <dt class="text-muted font-medium">
              {{ t('events.detail.who') }}
            </dt>
            <dd class="flex items-center gap-2">
              <UIcon
                name="i-lucide-user"
                class="size-4 text-muted"
              />
              {{ event.userName || t('events.log.unknownUser') }}
            </dd>
          </div>
          <div class="flex flex-col gap-1">
            <dt class="text-muted font-medium">
              {{ t('events.detail.itemId') }}
            </dt>
            <dd class="flex items-center gap-2 min-w-0">
              <code class="text-xs font-mono truncate">{{ event.itemId }}</code>
              <UButton
                color="neutral"
                variant="ghost"
                size="xs"
                icon="i-lucide-copy"
                :aria-label="t('events.detail.copy')"
                @click="copy(event.itemId)"
              />
            </dd>
          </div>
        </dl>

        <USeparator />

        <div class="flex flex-col gap-3">
          <h4 class="font-medium flex items-center gap-2">
            <UIcon
              name="i-lucide-git-compare"
              class="size-4 text-muted"
            />
            {{ t('events.detail.changes') }}
            <UBadge
              color="neutral"
              variant="subtle"
              size="sm"
              :label="t('events.log.fieldsChanged', event.changes?.length || 0)"
            />
          </h4>

          <CroutonEventChangesTable
            :changes="event.changes"
            :operation="event.operation"
            :collection="event.collectionName"
          />
        </div>
      </div>
    </template>
  </UModal>
</template>
