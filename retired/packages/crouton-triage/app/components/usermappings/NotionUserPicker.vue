<script setup lang="ts">
/**
 * NotionUserPicker - Reusable dropdown for selecting Notion users
 *
 * Fetches Notion workspace users and provides a searchable dropdown.
 * Used in user mapping flows to select Notion users.
 */

interface NotionUser {
  id: string
  name: string
  email: string | null
  type: 'person' | 'bot'
  avatarUrl: string | null
}

interface Props {
  /** Notion API token (legacy — prefer notionAccountId) */
  notionToken?: string
  /** Connected account ID for Notion token resolution */
  notionAccountId?: string
  /** Team ID for API context */
  teamId: string
  /** Selected user ID */
  modelValue?: string | null
  /** Placeholder text */
  placeholder?: string
  /** Disable the picker */
  disabled?: boolean
  /** Size variant */
  size?: 'sm' | 'md' | 'lg' | 'xl'
}

const props = withDefaults(defineProps<Props>(), {
  placeholder: 'Select Notion user...',
  disabled: false,
  size: 'md'
})

const emit = defineEmits<{
  'update:modelValue': [value: string | null]
  'select': [user: NotionUser | null]
}>()

// Use the Notion users composable
const { fetchNotionUsers, users, loading, error } = useTriageNotionUsers()

// Track if we've fetched users
const hasFetched = ref(false)

// Fetch users when token/accountId/teamId change or on mount
watch(
  () => [props.notionToken, props.notionAccountId, props.teamId],
  async ([token, accountId, team]) => {
    if ((token || accountId) && team) {
      await fetchNotionUsers({
        notionToken: token as string | undefined,
        accountId: accountId as string | undefined,
        teamId: team as string,
      })
      hasFetched.value = true
    }
  },
  { immediate: true }
)

// Format users for USelectMenu - use simple string items
const userItems = computed(() => {
  return users.value.map(user => ({
    label: `${user.name}${user.email ? ` (${user.email})` : ''}`,
    value: user.id
  }))
})

// Selected user object
const selectedUser = computed(() => {
  if (!props.modelValue) return null
  return users.value.find(u => u.id === props.modelValue) || null
})

// Handle selection change
function handleSelect(item: { label: string; value: string } | undefined) {
  const value = item?.value || null
  emit('update:modelValue', value)
  const user = value ? users.value.find(u => u.id === value) || null : null
  emit('select', user)
}
</script>

<template>
  <div class="notion-user-picker">
    <!-- Loading state -->
    <div v-if="loading && !hasFetched" class="flex items-center gap-2 text-muted text-sm">
      <UIcon name="i-lucide-loader-2" class="w-4 h-4 animate-spin" />
      Loading Notion users...
    </div>

    <!-- Error state -->
    <UAlert
      v-else-if="error"
      color="error"
      variant="soft"
      icon="i-lucide-alert-circle"
      :description="error"
      class="mb-2"
    />

    <!-- User picker -->
    <USelectMenu
      v-else
      :model-value="userItems.find(i => i.value === modelValue)"
      :items="userItems"
      :placeholder="placeholder"
      :disabled="disabled || loading"
      :loading="loading"
      searchable
      class="w-full"
      @update:model-value="handleSelect"
    >
      <!-- Selected value display -->
      <template #leading>
        <UAvatar
          v-if="selectedUser?.avatarUrl"
          :src="selectedUser.avatarUrl"
          size="2xs"
        />
        <UIcon
          v-else-if="selectedUser"
          name="i-lucide-user"
          class="w-4 h-4 text-muted"
        />
      </template>

      <!-- Empty state -->
      <template #empty>
        <div class="text-center py-4 text-muted text-sm">
          <p v-if="!hasFetched">Enter Notion token to load users</p>
          <p v-else>No users found</p>
        </div>
      </template>
    </USelectMenu>
  </div>
</template>
