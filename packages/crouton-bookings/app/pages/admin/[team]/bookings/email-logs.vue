<script setup lang="ts">
/**
 * Email Logs Page
 *
 * Displays a log of all booking emails sent for the team.
 * Shows status, recipient, trigger type, and timestamps.
 *
 * @route /admin/[team]/bookings/email-logs
 */
const route = useRoute()
const { teamId } = useTeamContext()
const { t } = useT()

// Fetch email logs
const { data: emailLogs, status, refresh } = await useFetch(
  () => `/api/teams/${teamId.value}/bookings-emaillogs`,
  {
    key: `email-logs-${teamId.value}`,
    query: {
      limit: 100,
      orderBy: 'createdAt',
      orderDir: 'desc'
    }
  }
)

// Refresh on every navigation to this page (handles keep-alive and client navigation)
onActivated(() => {
  refresh()
})

// Also refresh when route changes (for direct navigation)
watch(() => route.fullPath, () => {
  if (route.path.endsWith('/email-logs')) {
    refresh()
  }
})

// Normalize items from API response
const logs = computed(() => {
  if (!emailLogs.value) return []
  return Array.isArray(emailLogs.value) ? emailLogs.value : (emailLogs.value as { items?: any[] }).items || []
})

// Status badge config
const statusConfig: Record<string, { color: 'success' | 'warning' | 'error'; icon: string }> = {
  sent: {
    color: 'success',
    icon: 'i-lucide-check-circle'
  },
  pending: {
    color: 'warning',
    icon: 'i-lucide-clock'
  },
  failed: {
    color: 'error',
    icon: 'i-lucide-x-circle'
  }
}

// Trigger type labels
const triggerLabels = computed<Record<string, string>>(() => ({
  booking_created: t('bookings.emailLogs.triggerConfirmation'),
  reminder_before: t('bookings.emailLogs.triggerReminder'),
  booking_cancelled: t('bookings.emailLogs.triggerCancellation'),
  follow_up_after: t('bookings.emailLogs.triggerFollowUp')
}))

// Format date
function formatDate(dateString: string | null) {
  if (!dateString) return '-'
  return new Date(dateString).toLocaleString()
}

// Statistics
const stats = computed(() => {
  const sent = logs.value.filter((l: any) => l.status === 'sent').length
  const pending = logs.value.filter((l: any) => l.status === 'pending').length
  const failed = logs.value.filter((l: any) => l.status === 'failed').length
  return { sent, pending, failed, total: logs.value.length }
})

// Error modal state
const showErrorModal = ref(false)
const selectedError = ref<string | null>(null)

function viewError(error: string) {
  selectedError.value = error
  showErrorModal.value = true
}
</script>

<template>
  <div class="p-4 sm:p-6 space-y-6">
    <!-- Page Header -->
    <div class="flex items-center justify-between">
      <div>
        <h1 class="text-2xl font-bold">{{ t('bookings.emailLogs.title') }}</h1>
        <p class="text-muted mt-1">{{ t('bookings.emailLogs.description') }}</p>
      </div>
      <UButton
        icon="i-lucide-refresh-cw"
        color="neutral"
        variant="ghost"
        :loading="status === 'pending'"
        @click="refresh()"
      >
        {{ t('bookings.emailLogs.refresh') }}
      </UButton>
    </div>

    <!-- Stats Cards -->
    <div class="grid gap-4 sm:grid-cols-4">
      <UCard class="text-center">
        <div class="text-3xl font-bold">{{ stats.total }}</div>
        <div class="text-sm text-muted mt-1">{{ t('bookings.emailLogs.totalEmails') }}</div>
      </UCard>
      <UCard class="text-center">
        <div class="text-3xl font-bold text-success">{{ stats.sent }}</div>
        <div class="text-sm text-muted mt-1">{{ t('bookings.emailLogs.sent') }}</div>
      </UCard>
      <UCard class="text-center">
        <div class="text-3xl font-bold text-warning">{{ stats.pending }}</div>
        <div class="text-sm text-muted mt-1">{{ t('bookings.emailLogs.pending') }}</div>
      </UCard>
      <UCard class="text-center">
        <div class="text-3xl font-bold text-error">{{ stats.failed }}</div>
        <div class="text-sm text-muted mt-1">{{ t('bookings.emailLogs.failed') }}</div>
      </UCard>
    </div>

    <!-- Loading state -->
    <div v-if="status === 'pending'" class="flex justify-center py-12">
      <UIcon name="i-lucide-loader-2" class="size-8 animate-spin text-muted" />
    </div>

    <!-- Empty state -->
    <div v-else-if="logs.length === 0" class="text-center py-12 border border-dashed border-default rounded-lg">
      <UIcon name="i-lucide-mail" class="size-12 text-muted mx-auto mb-4" />
      <h3 class="text-lg font-medium mb-1">{{ t('bookings.emailLogs.noLogs') }}</h3>
      <p class="text-muted">{{ t('bookings.emailLogs.noLogsDescription') }}</p>
    </div>

    <!-- Logs Table -->
    <UCard v-else>
      <UTable
        :data="logs"
        :columns="[
          { accessorKey: 'status', header: t('bookings.emailLogs.columnStatus') },
          { accessorKey: 'recipientEmail', header: t('bookings.emailLogs.columnRecipient') },
          { accessorKey: 'triggerType', header: t('bookings.emailLogs.columnType') },
          { accessorKey: 'sentAt', header: t('bookings.emailLogs.columnSentAt') },
          { accessorKey: 'createdAt', header: t('bookings.emailLogs.columnCreated') },
          { accessorKey: 'error', header: t('bookings.emailLogs.columnError') }
        ]"
      >
        <template #status-cell="{ row }">
          <UBadge
            :color="statusConfig[row.original.status]?.color || 'neutral'"
            variant="subtle"
            size="sm"
            class="inline-flex items-center gap-1"
          >
            <UIcon
              :name="statusConfig[row.original.status]?.icon || 'i-lucide-circle'"
              class="size-3"
            />
            {{ row.original.status }}
          </UBadge>
        </template>
        <template #recipientEmail-cell="{ row }">
          <span class="font-mono text-xs">{{ row.original.recipientEmail }}</span>
        </template>
        <template #triggerType-cell="{ row }">
          <span class="text-muted">{{ triggerLabels[row.original.triggerType] || row.original.triggerType }}</span>
        </template>
        <template #sentAt-cell="{ row }">
          <span class="text-muted">{{ formatDate(row.original.sentAt) }}</span>
        </template>
        <template #createdAt-cell="{ row }">
          <span class="text-muted">{{ formatDate(row.original.createdAt) }}</span>
        </template>
        <template #error-cell="{ row }">
          <UButton
            v-if="row.original.error"
            size="xs"
            color="error"
            variant="ghost"
            icon="i-lucide-alert-circle"
            @click="viewError(row.original.error)"
          >
            {{ t('bookings.emailLogs.view') }}
          </UButton>
          <span v-else class="text-muted">-</span>
        </template>
      </UTable>
    </UCard>
  </div>

  <!-- Error Details Modal -->
  <UModal v-model:open="showErrorModal">
    <template #content>
      <div class="p-6">
        <h3 class="text-lg font-semibold mb-4 flex items-center gap-2">
          <UIcon name="i-lucide-alert-circle" class="size-5 text-error" />
          {{ t('bookings.emailLogs.errorDetails') }}
        </h3>
        <pre class="bg-error/10 text-error p-4 rounded-lg text-sm overflow-x-auto whitespace-pre-wrap">{{ selectedError }}</pre>
        <div class="flex justify-end mt-4">
          <UButton color="neutral" variant="ghost" @click="showErrorModal = false">
            {{ t('bookings.emailLogs.close') }}
          </UButton>
        </div>
      </div>
    </template>
  </UModal>
</template>