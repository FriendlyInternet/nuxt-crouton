<script setup lang="ts">
/**
 * Team Member Row Component
 *
 * Displays a single team member with actions (change role, remove).
 * Used within the Team/Members component.
 *
 * @example
 * ```vue
 * <TeamMemberRow
 *   :member="member"
 *   :can-manage="isAdmin"
 *   @role-change="onRoleChange"
 *   @remove="onRemove"
 * />
 * ```
 */
import type { MemberRole } from '../../../types'

interface MemberData {
  id: string
  userId: string
  role: MemberRole
  user?: {
    id: string
    name?: string | null
    email: string
    image?: string | null
  }
}

interface Props {
  /** The member to display */
  member: MemberData
  /** Current user ID (to disable actions on self) */
  currentUserId?: string
  /** Whether current user can manage members */
  canManage?: boolean
  /** Whether current user is owner (can change owner role) */
  isOwner?: boolean
  /** Loading state for actions */
  loading?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  canManage: false,
  isOwner: false,
  loading: false
})

const emit = defineEmits<{
  /** Emitted when role should be changed */
  roleChange: [memberId: string, role: MemberRole]
  /** Emitted when member should be removed */
  remove: [memberId: string]
}>()

const { t } = useT()

// Check if this is the current user
const isSelf = computed(() => props.member.userId === props.currentUserId)

// Check if this member is the owner
const memberIsOwner = computed(() => props.member.role === 'owner')

// Get display name
const displayName = computed(() => {
  return props.member.user?.name || props.member.user?.email || t('teams.unknownMember')
})

// Get initials for avatar fallback
const initials = computed(() => {
  const name = props.member.user?.name || props.member.user?.email || '?'
  return name.slice(0, 2).toUpperCase()
})

// Role options for dropdown
const roleOptions = computed(() => {
  const roles: Array<{ label: string, value: MemberRole }> = [
    { label: t('teams.member'), value: 'member' },
    { label: t('teams.admin'), value: 'admin' }
  ]

  // Only owners can transfer ownership
  if (props.isOwner && !isSelf.value) {
    roles.push({ label: t('teams.owner'), value: 'owner' })
  }

  return roles
})

// Can this member's role be changed?
const canChangeRole = computed(() => {
  // Can't change if no manage permission
  if (!props.canManage) return false
  // Can't change own role (except owner transferring)
  if (isSelf.value && !props.isOwner) return false
  // Can't change owner unless you're the owner
  if (memberIsOwner.value && !props.isOwner) return false
  return true
})

// Can this member be removed?
const canRemove = computed(() => {
  // Can't remove if no manage permission
  if (!props.canManage) return false
  // Can't remove self (use "Leave team" instead)
  if (isSelf.value) return false
  // Can't remove owner
  if (memberIsOwner.value) return false
  return true
})

// Handle role change
function handleRoleChange(role: MemberRole) {
  if (role !== props.member.role) {
    emit('roleChange', props.member.id, role)
  }
}

// Handle remove
function handleRemove() {
  emit('remove', props.member.id)
}

// Role badge color
const roleBadgeColor = computed(() => {
  switch (props.member.role) {
    case 'owner':
      return 'primary'
    case 'admin':
      return 'info'
    default:
      return 'neutral'
  }
})
</script>

<template>
  <div class="flex items-center justify-between py-3 px-4 hover:bg-muted/50 transition-colors">
    <!-- User Info -->
    <UUser
      :name="displayName"
      :description="member.user?.email"
      :avatar="{ src: member.user?.image ?? undefined, text: initials }"
      size="md"
    >
      <template #name>
        <div class="flex items-center gap-2">
          <span class="font-medium">{{ displayName }}</span>
          <UBadge
            :color="roleBadgeColor"
            variant="subtle"
            size="xs"
          >
            {{ member.role }}
          </UBadge>
          <span
            v-if="isSelf"
            class="text-xs text-muted"
          >({{ t('teams.you') }})</span>
        </div>
      </template>
    </UUser>

    <!-- Actions -->
    <div class="flex items-center gap-2">
      <!-- Role Selector -->
      <USelectMenu
        v-if="canChangeRole"
        :model-value="member.role"
        :items="roleOptions"
        value-key="value"
        :disabled="loading"
        size="sm"
        class="w-28"
        @update:model-value="handleRoleChange"
      />

      <!-- Remove Button -->
      <UButton
        v-if="canRemove"
        icon="i-lucide-user-x"
        variant="ghost"
        color="error"
        size="sm"
        :loading="loading"
        :title="t('teams.removeMember')"
        @click="handleRemove"
      />
    </div>
  </div>
</template>
