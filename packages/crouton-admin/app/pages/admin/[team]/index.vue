<script setup lang="ts">
/**
 * Team Admin Dashboard
 *
 * Overview page for team administrators showing quick stats
 * and navigation to management sections.
 *
 * @route /admin/[team]
 */
definePageMeta({
  middleware: ['auth', 'can'],
  can: 'admin:access',
  layout: 'admin'
})

const { teamSlug } = useTeamContext()
const { t } = useT()
const { currentTeam, members, loadMembers, loading } = useTeam()

// Load members on mount
onMounted(async () => {
  await loadMembers()
})

// Quick stats
const stats = computed(() => [
  {
    label: t('teams.members'),
    value: members.value.length,
    icon: 'i-lucide-users',
    to: `/admin/${teamSlug.value}/team`
  },
  {
    label: t('teams.settings'),
    value: '',
    icon: 'i-lucide-settings',
    to: `/admin/${teamSlug.value}/team/settings`
  },
  {
    label: t('teams.invitations'),
    value: '',
    icon: 'i-lucide-mail',
    to: `/admin/${teamSlug.value}/team/invitations`
  }
])

// Navigation items
const adminNavItems = computed(() => [
  {
    title: t('teams.members'),
    description: t('teams.manageMembersDescription'),
    icon: 'i-lucide-users',
    to: `/admin/${teamSlug.value}/team`
  },
  {
    title: t('teams.invitations'),
    description: t('teams.manageInvitationsDescription'),
    icon: 'i-lucide-mail-plus',
    to: `/admin/${teamSlug.value}/team/invitations`
  },
  {
    title: t('teams.teamSettings'),
    description: t('teams.teamSettingsDescription'),
    icon: 'i-lucide-settings',
    to: `/admin/${teamSlug.value}/team/settings`
  }
])
</script>

<template>
  <UDashboardPanel>
    <template #header>
      <UDashboardNavbar :title="t('teams.teamAdmin')">
        <template #leading>
          <UDashboardSidebarCollapse />
        </template>
      </UDashboardNavbar>
    </template>

    <template #body>
      <div class="space-y-6 p-6">
    <!-- Header -->
    <div>
      <h1 class="text-2xl font-bold">
        {{ t('teams.teamAdmin') }}
      </h1>
      <p class="text-muted mt-1">
        {{ t('teams.teamAdminDescription', { team: currentTeam?.name }) }}
      </p>
    </div>

    <!-- Team Info Card -->
    <UCard v-if="currentTeam">
      <div class="flex items-center gap-4">
        <UAvatar
          v-if="currentTeam.logo"
          :src="currentTeam.logo"
          :alt="currentTeam.name"
          size="xl"
        />
        <div
          v-else
          class="flex items-center justify-center size-16 rounded-full bg-muted"
        >
          <UIcon
            name="i-lucide-building-2"
            class="size-8 text-muted-foreground"
          />
        </div>
        <div class="flex-1">
          <h2 class="text-xl font-semibold">
            {{ currentTeam.name }}
          </h2>
          <p class="text-sm text-muted">
            /{{ currentTeam.slug }}
          </p>
        </div>
        <NuxtLink :to="`/admin/${teamSlug}/team/settings`">
          <UButton
            icon="i-lucide-settings"
            variant="ghost"
          >
            {{ t('common.settings') }}
          </UButton>
        </NuxtLink>
      </div>
    </UCard>

    <!-- Loading State -->
    <div
      v-if="loading"
      class="py-8 text-center text-muted"
    >
      <UIcon
        name="i-lucide-loader-2"
        class="size-6 animate-spin mx-auto mb-2"
      />
      <p>{{ t('common.loading') }}</p>
    </div>

    <!-- Admin Navigation -->
    <div
      v-else
      class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3"
    >
      <NuxtLink
        v-for="item in adminNavItems"
        :key="item.to"
        :to="item.to"
        class="block"
      >
        <UCard class="h-full hover:bg-muted/50 transition-colors cursor-pointer">
          <div class="flex items-start gap-4">
            <div class="flex items-center justify-center size-12 rounded-lg bg-primary/10">
              <UIcon
                :name="item.icon"
                class="size-6 text-primary"
              />
            </div>
            <div class="flex-1">
              <h3 class="font-semibold">
                {{ item.title }}
              </h3>
              <p class="text-sm text-muted mt-1">
                {{ item.description }}
              </p>
            </div>
            <UIcon
              name="i-lucide-chevron-right"
              class="size-5 text-muted-foreground"
            />
          </div>
        </UCard>
      </NuxtLink>
    </div>

    <!-- Quick Stats -->
    <div class="grid gap-4 sm:grid-cols-3">
      <UCard
        v-for="stat in stats"
        :key="stat.label"
        class="text-center"
      >
        <div class="flex flex-col items-center gap-2">
          <UIcon
            :name="stat.icon"
            class="size-8 text-muted-foreground"
          />
          <p class="text-2xl font-bold">
            {{ stat.value || '-' }}
          </p>
          <p class="text-sm text-muted">
            {{ stat.label }}
          </p>
        </div>
      </UCard>
    </div>
      </div>
    </template>
  </UDashboardPanel>
</template>
