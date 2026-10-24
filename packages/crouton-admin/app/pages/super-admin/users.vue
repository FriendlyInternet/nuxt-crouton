<script setup lang="ts">
/**
 * Super Admin Users Page
 *
 * User management with search, ban/unban, and impersonation.
 */
definePageMeta({
  layout: 'super-admin',
  middleware: 'super-admin'
})

const { t } = useT()

useSeoMeta({ title: () => t('superAdmin.pageTitle', { page: t('superAdmin.users.title') }) })

const search = ref('')
const debouncedSearch = ref('')

const searchTimer = ref<ReturnType<typeof setTimeout>>()
watch(search, (val) => {
  clearTimeout(searchTimer.value)
  searchTimer.value = setTimeout(() => { debouncedSearch.value = val }, 300)
})

const { data, status, error, refresh } = useFetch('/api/admin/users', {
  lazy: true,
  query: computed(() => ({
    pageSize: 50,
    search: debouncedSearch.value || undefined
  }))
})

const columns = computed(() => [
  { accessorKey: 'name', header: t('superAdmin.users.name') },
  { accessorKey: 'membershipCount', header: t('superAdmin.users.teams') },
  { accessorKey: 'status', header: t('superAdmin.users.status') },
  { accessorKey: 'createdAt', header: t('superAdmin.users.created') },
  { accessorKey: 'actions', header: '' }
])

function formatDate(date: string | Date) {
  return new Date(date).toLocaleDateString()
}

// Impersonation
const { startImpersonation } = useImpersonation()
const impersonating = ref(false)

async function handleImpersonate(userId: string) {
  impersonating.value = true
  try {
    await startImpersonation(userId)
  } catch {
    impersonating.value = false
  }
}
</script>

<template>
  <div class="p-6">
    <div class="mb-6 flex items-center justify-between">
      <div>
        <h1 class="text-2xl font-bold">{{ $t('superAdmin.users.title') }}</h1>
        <p class="text-sm text-muted">{{ $t('superAdmin.users.manageAllAccounts') }}</p>
      </div>
    </div>

    <UAlert
      v-if="error"
      color="error"
      icon="i-lucide-alert-circle"
      :title="$t('superAdmin.users.failedToLoadUsers')"
      :description="error.message"
      class="mb-4"
    />

    <UInput
      v-model="search"
      :placeholder="$t('superAdmin.users.searchPlaceholder')"
      icon="i-lucide-search"
      class="mb-4 max-w-sm"
    />

    <UTable
      :data="data?.items ?? []"
      :columns="columns"
      :loading="status === 'pending'"
    >
      <template #name-cell="{ row }">
        <div class="flex items-center gap-3">
          <UAvatar :src="row.original.image ?? undefined" :alt="row.original.name" size="sm" />
          <div>
            <p class="font-medium">{{ row.original.name }}</p>
            <p class="text-xs text-muted">{{ row.original.email }}</p>
          </div>
          <UBadge v-if="row.original.superAdmin" color="primary" variant="subtle" size="xs">
            {{ $t('superAdmin.users.adminBadge') }}
          </UBadge>
        </div>
      </template>

      <template #membershipCount-cell="{ row }">
        <span class="text-sm text-muted">{{ row.original.membershipCount }}</span>
      </template>

      <template #status-cell="{ row }">
        <UBadge
          :color="row.original.banned ? 'error' : 'success'"
          variant="subtle"
          size="xs"
        >
          {{ row.original.banned ? $t('superAdmin.users.statusBanned') : $t('superAdmin.users.statusActive') }}
        </UBadge>
      </template>

      <template #createdAt-cell="{ row }">
        <span class="text-sm text-muted">{{ formatDate(row.original.createdAt) }}</span>
      </template>

      <template #actions-cell="{ row }">
        <UDropdownMenu
          v-if="!row.original.superAdmin"
          :items="[
            [{
              label: t('superAdmin.users.impersonate'),
              icon: 'i-lucide-eye',
              disabled: row.original.banned,
              onSelect: () => handleImpersonate(row.original.id)
            }]
          ]"
        >
          <UButton
            variant="ghost"
            color="neutral"
            icon="i-lucide-ellipsis-vertical"
            size="xs"
            :loading="impersonating"
          />
        </UDropdownMenu>
      </template>
    </UTable>
  </div>
</template>
