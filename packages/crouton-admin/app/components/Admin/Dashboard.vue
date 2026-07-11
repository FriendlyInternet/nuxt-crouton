<script setup lang="ts">
/**
 * Dashboard Component
 *
 * Admin dashboard with stats cards, recent activity, and quick actions.
 * Uses useAdminStats() composable for data.
 */
import type { AdminStats } from '../../../types/admin'

const { t } = useT()

interface Props {
  /** Pre-loaded stats (optional, will fetch if not provided) */
  stats?: AdminStats | null
  /** Whether to show quick actions section */
  showQuickActions?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  showQuickActions: true
})

const emit = defineEmits<{
  navigate: [path: string]
}>()

const { stats: fetchedStats, loading, error } = useAdminStats({
  immediate: !props.stats
})

// Use provided stats or fetch them
const displayStats = computed(() => props.stats ?? fetchedStats.value)

const statCards = computed(() => {
  if (!displayStats.value) return []

  return [
    {
      label: t('superAdmin.stats.totalUsers'),
      value: displayStats.value.totalUsers,
      icon: 'i-lucide-users',
      trend: displayStats.value.newUsersToday,
      color: 'primary' as const
    },
    {
      label: t('superAdmin.stats.newThisWeek'),
      value: displayStats.value.newUsersWeek,
      icon: 'i-lucide-user-plus',
      color: 'success' as const
    },
    {
      label: t('superAdmin.stats.bannedUsers'),
      value: displayStats.value.bannedUsers,
      icon: 'i-lucide-ban',
      color: displayStats.value.bannedUsers > 0 ? 'warning' as const : 'primary' as const
    },
    {
      label: t('superAdmin.stats.totalTeams'),
      value: displayStats.value.totalTeams,
      icon: 'i-lucide-building-2',
      trend: displayStats.value.newTeamsWeek,
      color: 'primary' as const
    },
    {
      label: t('superAdmin.stats.activeSessions'),
      value: displayStats.value.activeSessions,
      icon: 'i-lucide-signal',
      color: 'success' as const
    },
    {
      label: t('superAdmin.stats.superAdmins'),
      value: displayStats.value.superAdminCount,
      icon: 'i-lucide-shield-check',
      color: 'primary' as const
    }
  ]
})

const quickActions = computed(() => [
  {
    label: t('superAdmin.quickActions.manageUsers'),
    description: t('superAdmin.quickActions.manageUsersDescription'),
    icon: 'i-lucide-users',
    path: '/super-admin/users'
  },
  {
    label: t('superAdmin.quickActions.viewTeams'),
    description: t('superAdmin.quickActions.viewTeamsDescription'),
    icon: 'i-lucide-building-2',
    path: '/super-admin/teams'
  }
])

function handleQuickAction(path: string) {
  emit('navigate', path)
  navigateTo(path)
}
</script>

<template>
  <div class="space-y-6">
    <!-- Error state -->
    <UAlert
      v-if="error"
      color="error"
      variant="soft"
      icon="i-lucide-triangle-alert"
      :title="t('superAdmin.stats.failedToLoad')"
      :description="error"
    />

    <!-- Stats Grid -->
    <div class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      <AdminStatsCard
        v-for="(stat, index) in statCards"
        :key="index"
        :value="stat.value"
        :label="stat.label"
        :icon="stat.icon"
        :trend="stat.trend"
        :color="stat.color"
        :loading="loading"
      />
    </div>

    <!-- Quick Actions -->
    <div
      v-if="showQuickActions"
      class="pt-4"
    >
      <h3 class="mb-4 text-lg font-medium text-gray-900 dark:text-white">
        {{ t('superAdmin.quickActions.title') }}
      </h3>
      <!-- Quick-action cards — UButton on semantic tokens (not raw buttons on
           hardcoded grays) so themes reach them (#1410) -->
      <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <UButton
          v-for="action in quickActions"
          :key="action.path"
          color="neutral"
          variant="outline"
          class="group w-full justify-start gap-4 p-4 text-left transition-colors hover:ring-primary hover:bg-primary/5"
          @click="handleQuickAction(action.path)"
        >
          <div class="flex size-10 shrink-0 items-center justify-center rounded-lg bg-elevated text-muted group-hover:bg-primary/10 group-hover:text-primary">
            <UIcon
              :name="action.icon"
              class="size-5"
            />
          </div>
          <div>
            <p class="font-medium text-highlighted">
              {{ action.label }}
            </p>
            <p class="text-sm text-muted">
              {{ action.description }}
            </p>
          </div>
          <UIcon
            name="i-lucide-chevron-right"
            class="ml-auto size-5 text-dimmed group-hover:text-primary"
          />
        </UButton>
      </div>
    </div>
  </div>
</template>
