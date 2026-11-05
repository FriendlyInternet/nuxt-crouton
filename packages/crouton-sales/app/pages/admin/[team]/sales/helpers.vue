<script setup lang="ts">
/**
 * Active Helpers — team-wide view of all currently logged-in helpers
 *
 * Data comes from scopedAccessToken (crouton-auth), not a sales collection.
 * Each row is an active scoped-access session with `role='helper'`.
 *
 * @route /admin/[team]/sales/helpers
 */
definePageMeta({ middleware: ['auth'] })

const { t } = useT()
const route = useRoute()
const teamParam = computed(() => route.params.team as string)

interface ActiveHelper {
  id: string
  displayName: string
  role: string
  resourceId: string
  eventTitle: string | null
  expiresAt: string
  lastActiveAt: string | null
}

const { data: helpers, pending, refresh } = await useFetch<ActiveHelper[]>(
  () => `/api/crouton-sales/teams/${teamParam.value}/active-helpers`,
  { default: () => [] }
)

const columns = [
  { accessorKey: 'displayName', header: t('sales.helpers.helper') },
  { accessorKey: 'eventTitle', header: t('sales.helpers.event') },
  { accessorKey: 'lastActiveAt', header: t('sales.helpers.lastActive') },
  { accessorKey: 'expiresAt', header: t('sales.helpers.expires') }
]
</script>

<template>
  <div class="space-y-4 p-4 sm:p-6">
    <div class="flex items-center justify-between">
      <div>
        <h2 class="text-2xl font-semibold">{{ t('sales.helpers.title') }}</h2>
        <p class="text-sm text-muted">{{ t('sales.helpers.description') }}</p>
      </div>
      <UButton
        variant="outline"
        size="sm"
        icon="i-lucide-refresh-cw"
        :loading="pending"
        @click="() => refresh()"
      >
        {{ t('sales.common.refresh') }}
      </UButton>
    </div>

    <UTable
      :data="helpers || []"
      :columns="columns"
      :loading="pending"
    >
      <template #lastActiveAt-cell="{ row }">
        <span class="text-sm text-muted">
          {{ row.original.lastActiveAt ? new Date(row.original.lastActiveAt).toLocaleString() : '—' }}
        </span>
      </template>
      <template #expiresAt-cell="{ row }">
        <span class="text-sm text-muted">
          {{ new Date(row.original.expiresAt).toLocaleString() }}
        </span>
      </template>
      <template #empty>
        <div class="p-12 text-center text-muted">
          <UIcon name="i-lucide-users" class="text-4xl mb-2" />
          <p>{{ t('sales.workspace.noHelpers') }}</p>
        </div>
      </template>
    </UTable>
  </div>
</template>
