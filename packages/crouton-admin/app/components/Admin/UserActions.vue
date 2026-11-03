<script setup lang="ts">
/**
 * UserActions Component
 *
 * Dropdown menu with user management actions.
 * Actions: ban, unban, delete, impersonate.
 */
import { computed } from 'vue'
import type { AdminUserListItem } from '../../../types/admin'

const { t } = useT()

interface Props {
  /** The user to show actions for */
  user: AdminUserListItem
  /** Whether actions are currently processing */
  loading?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  loading: false
})

const emit = defineEmits<{
  ban: [user: AdminUserListItem]
  unban: [user: AdminUserListItem]
  delete: [user: AdminUserListItem]
  impersonate: [user: AdminUserListItem]
}>()

const items = computed(() => {
  const actions: Array<Array<{
    label: string
    icon: string
    click: () => void
    disabled?: boolean
  }>> = []

  // View/Edit actions
  const viewActions = [
    {
      label: t('superAdmin.users.impersonate'),
      icon: 'i-lucide-eye',
      click: () => emit('impersonate', props.user),
      disabled: props.user.banned || props.user.superAdmin
    }
  ]

  // Ban/Unban actions
  const moderationActions = props.user.banned
    ? [
        {
          label: t('superAdmin.users.unbanUser'),
          icon: 'i-lucide-check-circle',
          click: () => emit('unban', props.user)
        }
      ]
    : [
        {
          label: t('superAdmin.users.banUser'),
          icon: 'i-lucide-ban',
          click: () => emit('ban', props.user),
          disabled: props.user.superAdmin
        }
      ]

  // Destructive actions
  const destructiveActions = [
    {
      label: t('superAdmin.users.deleteUser'),
      icon: 'i-lucide-trash-2',
      click: () => emit('delete', props.user),
      disabled: props.user.superAdmin
    }
  ]

  actions.push(viewActions)
  actions.push(moderationActions)
  actions.push(destructiveActions)

  return actions
})
</script>

<template>
  <UDropdownMenu
    :items="items"
    :disabled="loading"
  >
    <UButton
      color="neutral"
      variant="ghost"
      icon="i-lucide-ellipsis-vertical"
      :loading="loading"
      :aria-label="t('superAdmin.users.userActions')"
    />
  </UDropdownMenu>
</template>
