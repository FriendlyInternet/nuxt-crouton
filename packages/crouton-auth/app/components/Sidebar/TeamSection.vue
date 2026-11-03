<script setup lang="ts">
/**
 * TeamSection Component
 *
 * Displays the current team with switcher dropdown in the sidebar.
 * Only shown in multi-tenant mode.
 *
 * @example
 * ```vue
 * <SidebarTeamSection :collapsed="collapsed" />
 * ```
 */
import type { Team } from '../../../types'

interface Props {
  /** Whether the sidebar is collapsed */
  collapsed?: boolean
}

defineProps<Props>()

const { t } = useT()
const {
  currentTeam,
  teams,
  switchTeam,
  canCreateTeam,
  loading
} = useTeam()

const { buildDashboardUrl } = useTeamContext()

const showCreateModal = ref(false)

// Handle team switch
async function handleSwitch(team: Team) {
  if (team.id === currentTeam.value?.id) return

  await switchTeam(team.id)
  // Navigate to new team's dashboard
  const dashboardUrl = buildDashboardUrl(team.slug, '')
  await navigateTo(dashboardUrl)
}

// Build dropdown items
const dropdownItems = computed(() => {
  const items: Array<{ label: string, icon: string, click?: () => void }[]> = []

  // Team list
  const teamItems = teams.value.map(team => ({
    label: team.name,
    icon: team.id === currentTeam.value?.id ? 'i-lucide-check' : 'i-lucide-building-2',
    click: () => handleSwitch(team)
  }))

  if (teamItems.length > 0) {
    items.push(teamItems)
  }

  // Create team option
  if (canCreateTeam.value) {
    items.push([
      {
        label: t('teams.createTeam'),
        icon: 'i-lucide-plus',
        click: () => { showCreateModal.value = true }
      }
    ])
  }

  return items
})
</script>

<template>
  <div class="px-2">
    <!-- Collapsed: Just show team icon -->
    <UDropdownMenu
      v-if="collapsed"
      :items="dropdownItems"
    >
      <UButton
        :loading="loading"
        variant="ghost"
        color="neutral"
        square
        class="w-full"
      >
        <UAvatar
          v-if="currentTeam?.logo"
          :src="currentTeam.logo"
          :ui="{ image: 'object-contain' }"
          :as="{ img: 'img' }"
          :alt="currentTeam.name"
          size="xs"
        />
        <UIcon
          v-else
          name="i-lucide-building-2"
          class="size-5"
        />
      </UButton>
    </UDropdownMenu>

    <!-- Expanded: Show team name with dropdown -->
    <UDropdownMenu
      v-else
      :items="dropdownItems"
    >
      <UButton
        :loading="loading"
        variant="ghost"
        color="neutral"
        class="w-full justify-start"
        trailing-icon="i-lucide-chevrons-up-down"
      >
        <template #leading>
          <UAvatar
            v-if="currentTeam?.logo"
            :src="currentTeam.logo"
            :ui="{ image: 'object-contain' }"
            :as="{ img: 'img' }"
            :alt="currentTeam.name"
            size="2xs"
          />
          <UIcon
            v-else
            name="i-lucide-building-2"
            class="size-4"
          />
        </template>
        <span class="truncate">{{ currentTeam?.name || t('teams.selectTeam') }}</span>
      </UButton>
    </UDropdownMenu>

    <!-- Create Team Modal -->
    <UModal v-model:open="showCreateModal">
      <template #content>
        <UCard>
          <template #header>
            <div class="flex items-center justify-between">
              <h3 class="text-lg font-semibold">
                {{ t('teams.createTeam') }}
              </h3>
              <UButton
                icon="i-lucide-x"
                variant="ghost"
                color="neutral"
                size="sm"
                @click="showCreateModal = false"
              />
            </div>
          </template>

          <TeamCreateForm
            @success="showCreateModal = false"
            @cancel="showCreateModal = false"
          />
        </UCard>
      </template>
    </UModal>
  </div>
</template>
