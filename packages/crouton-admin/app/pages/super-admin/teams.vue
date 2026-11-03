<script setup lang="ts">
/**
 * Super Admin Teams Page
 *
 * Lists all teams with links to their admin areas.
 */
definePageMeta({
  layout: 'super-admin',
  middleware: 'super-admin'
})

const { t } = useT()

useSeoMeta({ title: () => t('superAdmin.pageTitle', { page: t('superAdmin.teams.title') }) })

const { data, status, error } = await useFetch('/api/admin/teams', {
  query: { pageSize: 100 }
})

const columns = computed(() => [
  { accessorKey: 'name', header: t('superAdmin.teams.name') },
  { accessorKey: 'memberCount', header: t('superAdmin.teams.members') },
  { accessorKey: 'createdAt', header: t('superAdmin.teams.created') },
  { accessorKey: 'actions', header: '' }
])

function formatDate(date: string | Date) {
  return new Date(date).toLocaleDateString()
}
</script>

<template>
  <div class="p-6">
    <div class="mb-6 flex items-center justify-between">
      <div>
        <h1 class="text-2xl font-bold">{{ $t('superAdmin.teams.title') }}</h1>
        <p class="text-sm text-muted">{{ $t('superAdmin.teams.allTeamsOnPlatform') }}</p>
      </div>
    </div>

    <UAlert
      v-if="error"
      color="error"
      icon="i-lucide-alert-circle"
      :title="$t('superAdmin.teams.failedToLoadTeams')"
      :description="error.message"
      class="mb-4"
    />

    <UTable
      :data="data?.items ?? []"
      :columns="columns"
      :loading="status === 'pending'"
    >
      <template #name-cell="{ row }">
        <NuxtLink
          :to="`/admin/${row.original.slug}`"
          class="flex items-center gap-3 group"
        >
          <UAvatar :src="row.original.logo ?? undefined" :alt="row.original.name" size="sm" />
          <div>
            <p class="font-medium group-hover:text-primary">
              {{ row.original.name }}
            </p>
            <p class="text-xs text-muted">{{ row.original.slug }}</p>
          </div>
        </NuxtLink>
      </template>

      <template #memberCount-cell="{ row }">
        <UBadge variant="subtle" color="neutral">
          {{ $t('superAdmin.teams.memberCount', { count: row.original.memberCount }, row.original.memberCount) }}
        </UBadge>
      </template>

      <template #createdAt-cell="{ row }">
        <span class="text-sm text-muted">{{ formatDate(row.original.createdAt) }}</span>
      </template>

      <template #actions-cell="{ row }">
        <UButton
          :to="`/admin/${row.original.slug}`"
          variant="ghost"
          color="neutral"
          icon="i-lucide-arrow-right"
          size="xs"
        />
      </template>
    </UTable>
  </div>
</template>
