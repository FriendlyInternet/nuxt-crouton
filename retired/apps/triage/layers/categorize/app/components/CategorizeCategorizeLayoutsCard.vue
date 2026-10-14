<script setup lang="ts">
import { inject } from 'vue'
import { LAYOUT_ACTION_KEY } from '../utils/layoutAction'

const props = defineProps<{
  item: any
  layout: 'list' | 'grid'
  collection: string
  size?: string
  stateless?: boolean
}>()

const layoutAction = inject(LAYOUT_ACTION_KEY, undefined)

function handleClick() {
  layoutAction?.('view', [props.item.id])
}

function handleDelete() {
  layoutAction?.('delete', [props.item.id])
}

const cardCount = computed(() => {
  return props.item.layout?.cards?.length || 0
})

const groupCount = computed(() => {
  return props.item.layout?.groups?.length || 0
})

const updatedAgo = computed(() => {
  if (!props.item.updatedAt) return null
  const diff = Date.now() - new Date(props.item.updatedAt).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
})
</script>

<template>
  <UCard
    variant="outline"
    :ui="{ root: 'hover:shadow-md hover:border-primary-300 dark:hover:border-primary-700 transition-all cursor-pointer group', body: 'p-4' }"
    @click="handleClick"
  >
    <div class="flex flex-col gap-2">
      <div class="flex items-start justify-between gap-2">
        <div class="min-w-0 flex-1">
          <h3 class="text-sm font-semibold text-default truncate">
            {{ item.name || 'Untitled Layout' }}
          </h3>
          <p class="text-xs text-muted mt-0.5 truncate">
            {{ item.categoryProperty || 'No category' }}
          </p>
        </div>
        <div class="flex items-center gap-1 shrink-0">
          <UButton
            icon="i-lucide-trash-2"
            size="xs"
            variant="ghost"
            color="error"
            class="opacity-0 group-hover:opacity-100 transition-opacity"
            @click.stop="handleDelete"
          />
          <UIcon name="i-lucide-arrow-right" class="text-muted" />
        </div>
      </div>

      <div class="flex items-center gap-3 text-xs text-muted">
        <span class="flex items-center gap-1">
          <UIcon name="i-lucide-layers" class="size-3" />
          {{ groupCount }} groups
        </span>
        <span class="flex items-center gap-1">
          <UIcon name="i-lucide-square" class="size-3" />
          {{ cardCount }} cards
        </span>
      </div>

      <div v-if="updatedAgo" class="text-[11px] text-muted/70">
        Updated {{ updatedAgo }}
      </div>
    </div>
  </UCard>
</template>
