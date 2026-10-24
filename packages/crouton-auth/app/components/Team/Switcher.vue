<script setup lang="ts">
/**
 * Team Switcher Component
 *
 * Select menu to switch between teams (organizations) or create new ones.
 * Always shown in multi-tenant mode, even with just one team.
 *
 * @example
 * ```vue
 * <TeamSwitcher />
 * ```
 */
import type { SelectMenuItem, AvatarProps } from '@nuxt/ui'
import type { Team } from '../../../types'

interface Props {
  /** Show create team option */
  showCreate?: boolean
  /** Custom label instead of team name */
  label?: string
  /** Size variant */
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl'
  /** Hide search input for small lists */
  searchable?: boolean
  /** Route prefix for navigation after team switch (default: '') */
  routePrefix?: string
}

const props = withDefaults(defineProps<Props>(), {
  showCreate: true,
  size: 'md',
  searchable: false,
  routePrefix: ''
})

const emit = defineEmits<{
  /** Emitted when team is switched */
  switch: [team: Team]
  /** Emitted when create team is clicked */
  create: []
}>()

const { t } = useT()
const config = useAuthConfig()
const {
  currentTeam,
  teams,
  switchTeam,
  canCreateTeam,
  loading
} = useTeam()

// Show switcher based on config (default: show if multiple teams exist)
const showSwitcher = computed(() => config?.teams?.showSwitcher !== false)

// Create team modal state
const showCreateModal = ref(false)

// Build items for select menu
const selectItems = computed<SelectMenuItem[][]>(() => {
  const teamItems: SelectMenuItem[] = teams.value.map(team => ({
    label: team.name,
    value: team.id,
    icon: 'i-lucide-building-2'
  }))

  const groups: SelectMenuItem[][] = []

  if (teamItems.length > 0) {
    groups.push(teamItems)
  }

  // Create team option
  if (props.showCreate && canCreateTeam.value) {
    groups.push([
      {
        label: t('teams.createTeam'),
        value: '__create__',
        icon: 'i-lucide-plus'
      }
    ])
  }

  return groups
})

// Selected team ID for v-model
const selectedTeamId = computed({
  get: () => currentTeam.value?.id,
  set: async (value: string | undefined) => {
    if (!value) return

    // Handle create team action
    if (value === '__create__') {
      showCreateModal.value = true
      emit('create')
      return
    }

    // Switch team
    const team = teams.value.find(t => t.id === value)
    if (team && team.id !== currentTeam.value?.id) {
      await switchTeam(team.id)
      emit('switch', team)

      // Navigate to new team's context (dashboard or admin)
      const targetUrl = `${props.routePrefix}/${team.slug}`
      await navigateTo(targetUrl)
    }
  }
})

// Handle team created - switch to it
async function handleTeamCreated(team: Team) {
  showCreateModal.value = false
  await switchTeam(team.id)
  emit('switch', team)

  const targetUrl = `${props.routePrefix}/${team.slug}`
  await navigateTo(targetUrl)
}
</script>

<template>
  <div v-if="showSwitcher">
    <USelectMenu
      v-model="selectedTeamId"
      :items="selectItems"
      value-key="value"
      label-key="label"
      :size="size"
      :loading="loading"
      :search-input="searchable"
      :placeholder="label || t('teams.selectTeam')"
      variant="ghost"
      class="w-full"
      :ui="{
        base: 'w-full justify-between',
        trailingIcon: 'group-data-[state=open]:rotate-180 transition-transform duration-200'
      }"
    >
      <template #leading="{ ui }">
        <UAvatar
          v-if="currentTeam?.logo"
          :src="currentTeam.logo"
          :ui="{ image: 'object-contain' }"
          :as="{ img: 'img' }"
          :alt="currentTeam?.name"
          :size="(ui.leadingAvatarSize() as AvatarProps['size'])"
          :class="ui.leadingAvatar()"
        />
        <UIcon
          v-else
          name="i-lucide-building-2"
          :class="ui.leadingIcon()"
        />
      </template>
      <template #default>
        <span class="truncate">{{ currentTeam?.name || label || t('teams.selectTeam') }}</span>
      </template>
    </USelectMenu>

    <!-- Create Team Modal -->
    <UModal v-model:open="showCreateModal">
      <template #content="{ close }">
        <div class="p-6">
          <h3 class="text-lg font-semibold mb-4">
            {{ t('teams.createTeam') }}
          </h3>
          <TeamCreateForm
            @success="handleTeamCreated"
            @cancel="close"
          />
        </div>
      </template>
    </UModal>
  </div>

  <!-- Non-multi-tenant: just show current team name -->
  <div
    v-else-if="currentTeam"
    class="flex items-center gap-2 text-sm"
  >
    <UAvatar
      v-if="currentTeam.logo"
      :src="currentTeam.logo"
      :ui="{ image: 'object-contain' }"
      :as="{ img: 'img' }"
      :alt="currentTeam.name"
      size="2xs"
    />
    <UIcon
      v-else
      name="i-lucide-building-2"
      class="size-4 text-muted"
    />
    <span class="font-medium">{{ currentTeam.name }}</span>
  </div>
</template>
