<script setup lang="ts">
/**
 * Job Monitoring Page
 *
 * Displays triage processing jobs with filtering and retry.
 *
 * @route /admin/[team]/triage/jobs
 */
import { useTimeAgo } from '@vueuse/core'

const { currentTeam } = useTeam()
const { open: openCrouton } = useCrouton()
const notify = useNotify()

const { items: jobs, pending, refresh: refreshJobs } = await useCollectionQuery('triageJobs')

const selectedFilter = ref<'all' | 'processing' | 'completed' | 'failed' | 'retrying' | 'pending'>('all')
const retryingJobId = ref<string | null>(null)

const jobStats = computed(() => {
  const allJobs = jobs.value || []
  return {
    total: allJobs.length,
    processing: allJobs.filter((j: any) => j.status === 'processing').length,
    completed: allJobs.filter((j: any) => j.status === 'completed').length,
    failed: allJobs.filter((j: any) => j.status === 'failed').length,
    retrying: allJobs.filter((j: any) => j.status === 'retrying').length,
    pending: allJobs.filter((j: any) => j.status === 'pending').length
  }
})

const statusFilters = computed(() => [
  { label: 'All', value: 'all' as const, count: jobStats.value.total },
  { label: 'Processing', value: 'processing' as const, count: jobStats.value.processing },
  { label: 'Completed', value: 'completed' as const, count: jobStats.value.completed },
  { label: 'Failed', value: 'failed' as const, count: jobStats.value.failed },
  { label: 'Retrying', value: 'retrying' as const, count: jobStats.value.retrying }
])

const filteredJobs = computed(() => {
  const allJobs = jobs.value || []
  if (selectedFilter.value === 'all') {
    return allJobs
  }
  return allJobs.filter((j: any) => j.status === selectedFilter.value)
})

function formatStage(stage: string | undefined) {
  if (!stage) return 'Processing'
  return stage
    .split('_')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ')
}

function formatRelativeTime(date: string | Date) {
  const { value } = useTimeAgo(date)
  return value
}

function formatDuration(ms: number) {
  if (ms < 1000) {
    return `${ms}ms`
  }
  const seconds = Math.floor(ms / 1000)
  if (seconds < 60) {
    return `${seconds}s`
  }
  const minutes = Math.floor(seconds / 60)
  const remainingSeconds = seconds % 60
  if (minutes < 60) {
    return `${minutes}m ${remainingSeconds}s`
  }
  const hours = Math.floor(minutes / 60)
  const remainingMinutes = minutes % 60
  return `${hours}h ${remainingMinutes}m`
}

function openJobDetails(job: any) {
  openCrouton('view', 'triageJobs', [job.id])
}

async function retryJob(job: any) {
  if (!job.discussionId) {
    notify.error('Cannot retry job', { description: 'No discussion ID found for this job' })
    return
  }

  retryingJobId.value = job.id

  try {
    const response = await $fetch(`/api/crouton-triage/teams/${currentTeam.value?.id}/discussions/${job.discussionId}/retry`, {
      method: 'POST',
      body: {}
    })

    notify.success('Retry successful', { description: 'The discussion is being reprocessed' })

    await refreshJobs()
  } catch (error: any) {
    console.error('Failed to retry job:', error)

    const errorMessage = error.data?.message || error.message || 'Failed to retry job'

    notify.error('Retry failed', { description: errorMessage })
  } finally {
    retryingJobId.value = null
  }
}
</script>

<template>
  <div class="p-4 space-y-6">
    <!-- Job Statistics -->
    <div class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
      <UCard>
        <div class="flex items-center gap-3">
          <div class="w-10 h-10 rounded-lg bg-blue-500/10 flex items-center justify-center flex-shrink-0">
            <UIcon name="i-lucide-activity" class="w-5 h-5 text-blue-500" />
          </div>
          <div>
            <p class="text-2xl font-bold">{{ jobStats.total }}</p>
            <p class="text-xs text-muted-foreground">Total Jobs</p>
          </div>
        </div>
      </UCard>

      <UCard>
        <div class="flex items-center gap-3">
          <div class="w-10 h-10 rounded-lg bg-amber-500/10 flex items-center justify-center flex-shrink-0">
            <UIcon name="i-lucide-loader-2" class="w-5 h-5 text-amber-500 animate-spin" />
          </div>
          <div>
            <p class="text-2xl font-bold">{{ jobStats.processing }}</p>
            <p class="text-xs text-muted-foreground">Processing</p>
          </div>
        </div>
      </UCard>

      <UCard>
        <div class="flex items-center gap-3">
          <div class="w-10 h-10 rounded-lg bg-green-500/10 flex items-center justify-center flex-shrink-0">
            <UIcon name="i-lucide-check-circle" class="w-5 h-5 text-green-500" />
          </div>
          <div>
            <p class="text-2xl font-bold">{{ jobStats.completed }}</p>
            <p class="text-xs text-muted-foreground">Completed</p>
          </div>
        </div>
      </UCard>

      <UCard>
        <div class="flex items-center gap-3">
          <div class="w-10 h-10 rounded-lg bg-red-500/10 flex items-center justify-center flex-shrink-0">
            <UIcon name="i-lucide-x-circle" class="w-5 h-5 text-red-500" />
          </div>
          <div>
            <p class="text-2xl font-bold">{{ jobStats.failed }}</p>
            <p class="text-xs text-muted-foreground">Failed</p>
          </div>
        </div>
      </UCard>

      <UCard>
        <div class="flex items-center gap-3">
          <div class="w-10 h-10 rounded-lg bg-purple-500/10 flex items-center justify-center flex-shrink-0">
            <UIcon name="i-lucide-rotate-cw" class="w-5 h-5 text-purple-500" />
          </div>
          <div>
            <p class="text-2xl font-bold">{{ jobStats.retrying }}</p>
            <p class="text-xs text-muted-foreground">Retrying</p>
          </div>
        </div>
      </UCard>
    </div>

    <!-- Filters and Actions -->
    <UCard>
      <div class="flex flex-col sm:flex-row gap-3 items-stretch sm:items-center justify-between">
        <div class="flex flex-wrap gap-2" role="group" aria-label="Filter jobs by status">
          <UButton
            v-for="filter in statusFilters"
            :key="filter.value"
            :color="selectedFilter === filter.value ? 'primary' : 'neutral'"
            :variant="selectedFilter === filter.value ? 'solid' : 'outline'"
            size="sm"
            @click="selectedFilter = filter.value"
            :aria-pressed="selectedFilter === filter.value"
            :aria-label="`Filter by ${filter.label.toLowerCase()}`"
            class="touch-manipulation"
          >
            {{ filter.label }}
            <span v-if="filter.count !== undefined" class="ml-1 opacity-75">
              ({{ filter.count }})
            </span>
          </UButton>
        </div>

        <div class="flex gap-2 w-full sm:w-auto">
          <UButton
            color="neutral"
            variant="outline"
            size="sm"
            icon="i-lucide-refresh-cw"
            :disabled="pending"
            :loading="pending"
            aria-label="Refresh jobs list"
            class="flex-1 sm:flex-none touch-manipulation"
            @click="refreshJobs"
          >
            <span class="hidden sm:inline">Refresh</span>
          </UButton>
        </div>
      </div>
    </UCard>

    <!-- Jobs List -->
    <UCard>
      <template #header>
        <div class="flex items-center justify-between">
          <h3 class="text-base font-semibold">
            {{ selectedFilter === 'all' ? 'All Jobs' : `${selectedFilter.charAt(0).toUpperCase() + selectedFilter.slice(1)} Jobs` }}
          </h3>
          <span class="text-sm text-muted-foreground">
            {{ filteredJobs.length }} {{ filteredJobs.length === 1 ? 'job' : 'jobs' }}
          </span>
        </div>
      </template>

      <!-- Loading State -->
      <div v-if="pending" class="space-y-3">
        <div v-for="i in 5" :key="i" class="border rounded-lg p-4 animate-pulse">
          <div class="flex items-start justify-between gap-4">
            <div class="flex-1 space-y-3">
              <div class="h-4 bg-muted rounded w-1/3"></div>
              <div class="h-3 bg-muted rounded w-1/2"></div>
              <div class="h-3 bg-muted rounded w-2/3"></div>
            </div>
            <div class="h-6 w-20 bg-muted rounded"></div>
          </div>
        </div>
      </div>

      <!-- Empty State -->
      <div v-else-if="filteredJobs.length === 0" class="text-center py-12 px-4" role="status" aria-live="polite">
        <div class="w-16 h-16 sm:w-20 sm:h-20 rounded-full bg-muted/50 flex items-center justify-center mx-auto mb-4">
          <UIcon name="i-lucide-inbox" class="w-8 h-8 sm:w-10 sm:h-10 text-muted-foreground" />
        </div>
        <h3 class="text-base sm:text-lg font-semibold mb-2">No jobs found</h3>
        <p class="text-xs sm:text-sm text-muted-foreground max-w-md mx-auto mb-6">
          {{ selectedFilter === 'all'
            ? 'No processing jobs yet. Jobs will appear here when discussions are processed from Slack or Figma.'
            : `No ${selectedFilter} jobs at the moment. Try selecting a different filter or check back later.`
          }}
        </p>
        <div v-if="selectedFilter === 'all'" class="flex flex-col sm:flex-row gap-3 justify-center items-center">
          <UButton
            color="primary"
            icon="i-lucide-settings"
            :to="`/admin/${currentTeam?.slug}/triage`"
            aria-label="Configure integrations"
          >
            Configure Integrations
          </UButton>
          <UButton
            color="neutral"
            variant="outline"
            icon="i-lucide-book-open"
            external
            to="/docs/getting-started"
            aria-label="View documentation"
          >
            View Documentation
          </UButton>
        </div>
      </div>

      <!-- Jobs List -->
      <div v-else class="divide-y divide-default">
        <div
          v-for="job in filteredJobs"
          :key="job.id"
          class="flex items-center gap-4 py-3 px-1 hover:bg-elevated/50 transition-colors cursor-pointer group"
          role="button"
          tabindex="0"
          @click="openJobDetails(job)"
          @keydown.enter="openJobDetails(job)"
          @keydown.space.prevent="openJobDetails(job)"
        >
          <!-- Status Indicator -->
          <div
            class="w-2 h-2 rounded-full flex-shrink-0"
            :class="{
              'bg-green-500': job.status === 'completed',
              'bg-red-500': job.status === 'failed',
              'bg-amber-500 animate-pulse': job.status === 'processing',
              'bg-purple-500': job.status === 'retrying',
              'bg-gray-400': job.status === 'pending'
            }"
          ></div>

          <!-- Main Content -->
          <div class="flex-1 min-w-0">
            <div class="flex items-center gap-2">
              <span class="text-sm font-medium">{{ formatStage(job.stage) }}</span>
              <span v-if="job.status === 'processing'" class="text-xs text-muted-foreground">
                ({{ job.attempts }}/{{ job.maxAttempts }})
              </span>
            </div>

            <p v-if="job.status === 'failed' && job.error" class="text-xs text-red-500 truncate mt-0.5">
              {{ job.error }}
            </p>

            <p v-else-if="job.taskIds?.length" class="text-xs text-muted-foreground mt-0.5">
              Created {{ job.taskIds.length }} {{ job.taskIds.length === 1 ? 'task' : 'tasks' }}
            </p>
          </div>

          <!-- Time Info -->
          <div class="flex items-center gap-3 text-xs text-muted-foreground flex-shrink-0">
            <span v-if="job.processingTime" class="hidden sm:inline">{{ formatDuration(job.processingTime) }}</span>
            <span>{{ formatRelativeTime((job.completedAt || job.startedAt) as string | Date) }}</span>
          </div>

          <!-- Retry or Chevron -->
          <div class="flex-shrink-0">
            <UButton
              v-if="job.status === 'failed' && job.discussionId"
              color="neutral"
              variant="ghost"
              size="xs"
              icon="i-lucide-rotate-cw"
              :loading="retryingJobId === job.id"
              :disabled="retryingJobId !== null"
              class="opacity-0 group-hover:opacity-100 transition-opacity"
              @click.stop="retryJob(job)"
            />
            <UIcon
              v-else
              name="i-lucide-chevron-right"
              class="w-4 h-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity"
            />
          </div>
        </div>
      </div>
    </UCard>
  </div>
</template>
