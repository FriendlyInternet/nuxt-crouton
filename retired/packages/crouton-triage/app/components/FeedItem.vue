<script setup lang="ts">
import { useTimeAgo } from '@vueuse/core'
import type { FeedItem } from '../composables/useTriageFeed'

interface Props {
  item: FeedItem
}

const props = defineProps<Props>()

const emit = defineEmits<{
  retry: [discussionId: string]
}>()

const notify = useNotify()
const retrying = ref(false)
const expanded = ref(false)

// Source icon mapping (reused from FlowPipelineVisual)
function getSourceIcon(sourceType: string): string {
  const icons: Record<string, string> = {
    slack: 'i-lucide-slack',
    figma: 'i-lucide-figma',
    notion: 'i-simple-icons-notion',
    email: 'i-lucide-mail',
  }
  return icons[sourceType] || 'i-lucide-inbox'
}

function getSourceColor(sourceType: string): string {
  const colors: Record<string, string> = {
    slack: 'text-[#4A154B] dark:text-[#E01E5A]',
    figma: 'text-[#F24E1E]',
    notion: 'text-gray-900 dark:text-white',
    email: 'text-blue-500',
  }
  return colors[sourceType] || 'text-gray-500'
}

// Status styling
function getStatusColor(status: string): string {
  const colors: Record<string, string> = {
    completed: 'bg-green-500',
    failed: 'bg-red-500',
    processing: 'bg-amber-500 animate-pulse',
    retrying: 'bg-purple-500',
    pending: 'bg-gray-400',
    analyzed: 'bg-blue-500',
  }
  return colors[status] || 'bg-gray-400'
}

function getStatusLabel(status: string): string {
  const labels: Record<string, string> = {
    completed: 'Completed',
    failed: 'Failed',
    processing: 'Processing',
    retrying: 'Retrying',
    pending: 'Pending',
    analyzed: 'Analyzed',
  }
  return labels[status] || status
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  const seconds = (ms / 1000).toFixed(1)
  return `${seconds}s`
}

const timeAgo = useTimeAgo(computed(() => props.item.timestamp))

async function handleRetry() {
  retrying.value = true
  emit('retry', props.item.discussionId)
  // Parent handles the actual retry - we just track UI state
  // Reset after a delay since we don't have a callback
  setTimeout(() => { retrying.value = false }, 3000)
}
</script>

<template>
  <div class="group py-3 px-3 rounded-lg hover:bg-elevated/50 transition-colors">
    <!-- Header row: source icon, title, time -->
    <div class="flex items-start gap-3">
      <!-- Source icon -->
      <div class="flex-shrink-0 mt-0.5">
        <UIcon
          :name="getSourceIcon(item.sourceType)"
          :class="['w-5 h-5', getSourceColor(item.sourceType)]"
        />
      </div>

      <!-- Content -->
      <div class="flex-1 min-w-0">
        <!-- Title row -->
        <div class="flex items-center gap-2">
          <span class="text-sm font-medium truncate">{{ item.title }}</span>
          <span class="text-xs text-muted-foreground flex-shrink-0">{{ timeAgo }}</span>
        </div>

        <!-- AI Summary (truncated, expandable) -->
        <p
          v-if="item.aiSummary"
          class="text-xs text-muted-foreground mt-1 cursor-pointer"
          :class="{ 'line-clamp-2': !expanded }"
          @click="expanded = !expanded"
        >
          "{{ item.aiSummary }}"
        </p>

        <!-- Tasks checklist -->
        <div v-if="item.tasks.length > 0" class="flex flex-wrap gap-x-3 gap-y-1 mt-1.5">
          <a
            v-for="task in item.tasks"
            :key="task.id"
            :href="task.externalUrl"
            target="_blank"
            rel="noopener"
            class="inline-flex items-center gap-1 text-xs hover:underline"
            :class="task.status === 'completed' ? 'text-green-600 dark:text-green-400' : 'text-muted-foreground'"
          >
            <UIcon
              :name="task.status === 'completed' ? 'i-lucide-check' : 'i-lucide-circle'"
              class="w-3 h-3 flex-shrink-0"
            />
            <span class="truncate max-w-[200px]">{{ task.title }}</span>
          </a>
        </div>

        <!-- Status row -->
        <div class="flex items-center gap-2 mt-1.5">
          <div
            class="w-1.5 h-1.5 rounded-full flex-shrink-0"
            :class="getStatusColor(item.status)"
          />
          <span class="text-xs text-muted-foreground">{{ getStatusLabel(item.status) }}</span>
          <span v-if="item.processingTime" class="text-xs text-muted-foreground">
            · {{ formatDuration(item.processingTime) }}
          </span>

          <!-- Error message for failed items -->
          <span v-if="item.status === 'failed' && item.error" class="text-xs text-red-500 truncate">
            · {{ item.error }}
          </span>

          <!-- Retry button for failed items -->
          <UButton
            v-if="item.status === 'failed'"
            color="neutral"
            variant="ghost"
            size="xs"
            icon="i-lucide-rotate-cw"
            :loading="retrying"
            class="opacity-0 group-hover:opacity-100 transition-opacity ml-auto"
            @click="handleRetry"
          >
            Retry
          </UButton>
        </div>
      </div>
    </div>
  </div>
</template>
