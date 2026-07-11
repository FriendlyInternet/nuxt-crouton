<script setup lang="ts">
/**
 * Team Members Component
 *
 * Displays list of team members with management actions.
 * Includes per-row dropdown actions, bulk selection, and bulk actions.
 * Supports grid (card) and table (list) layouts.
 *
 * @example
 * ```vue
 * <TeamMembers @invite="openInviteModal" />
 * ```
 */
import { h, resolveComponent } from 'vue'
import type { TableColumn, DropdownMenuItem } from '@nuxt/ui'
import type { MemberRole, Member, MemberWithUser } from '../../../types'

interface Props {
  /** Show invite button */
  showInviteButton?: boolean
}

withDefaults(defineProps<Props>(), {
  showInviteButton: true
})

const emit = defineEmits<{
  /** Emitted when invite is clicked */
  invite: []
}>()

const { t } = useT()
const {
  currentTeam,
  members,
  loadMembers,
  updateMemberRole,
  removeMember,
  canManageMembers,
  canInviteMembers,
  isOwner,
  loading: teamLoading
} = useTeam()

const {
  sendPasswordReset,
  banUser,
  unbanUser,
  revokeUserSessions,
  impersonateUser,
  bulkSendPasswordReset,
  bulkBanUsers,
  bulkUnbanUsers,
  bulkRevokeUserSessions,
  loading: adminLoading
} = useAdmin()

const { user } = useSession()
const notify = useNotify()

// Layout toggle
const layout = ref<'grid' | 'table'>('grid')

// Local loading state
const loadingMemberId = ref<string | null>(null)

// Selection state for bulk actions
const selectedMemberIds = ref<Set<string>>(new Set())

// Load members on mount
onMounted(async () => {
  await loadMembers()
})

// Reload when team changes
watch(currentTeam, async () => {
  await loadMembers()
  selectedMemberIds.value.clear()
})

// Toggle selection for a single member
function toggleSelection(memberId: string) {
  const newSet = new Set(selectedMemberIds.value)
  if (newSet.has(memberId)) {
    newSet.delete(memberId)
  } else {
    newSet.add(memberId)
  }
  selectedMemberIds.value = newSet
}

// Toggle select all
function toggleSelectAll() {
  if (selectedMemberIds.value.size === actionableMembers.value.length) {
    selectedMemberIds.value = new Set()
  } else {
    selectedMemberIds.value = new Set(actionableMembers.value.map(m => m.id))
  }
}

// Members that can have actions performed on them (not self, not owner if not owner)
const actionableMembers = computed(() => {
  return sortedMembers.value.filter(m => {
    if (m.userId === user.value?.id) return false
    if (m.role === 'owner' && !isOwner.value) return false
    return true
  })
})

const allSelected = computed(() =>
  actionableMembers.value.length > 0 && selectedMemberIds.value.size === actionableMembers.value.length
)

// Clear selection
function clearSelection() {
  selectedMemberIds.value = new Set()
}

// Handle role change
async function handleRoleChange(memberId: string, role: MemberRole) {
  loadingMemberId.value = memberId
  try {
    const member = members.value.find(m => m.id === memberId)
    if (member) {
      await updateMemberRole(member.id, role)
      notify.success(t('teams.roleUpdated'), { description: t('teams.roleUpdatedDescription') })
    }
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : t('teams.failedToUpdateRole')
    notify.error(t('errors.generic'), { description: message })
  } finally {
    loadingMemberId.value = null
  }
}

// Handle member removal
async function handleRemove(memberId: string) {
  loadingMemberId.value = memberId
  try {
    await removeMember(memberId)
    selectedMemberIds.value.delete(memberId)
    notify.success(t('teams.memberRemoved'), { description: t('teams.memberRemovedDescription') })
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : t('teams.failedToRemoveMember')
    notify.error(t('errors.generic'), { description: message })
  } finally {
    loadingMemberId.value = null
  }
}

// Bulk action handlers
async function handleBulkPasswordReset() {
  const emails = getSelectedEmails()
  if (emails.length) {
    await bulkSendPasswordReset(emails)
    clearSelection()
  }
}

async function handleBulkForceLogout() {
  const userIds = getSelectedUserIds()
  if (userIds.length) {
    await bulkRevokeUserSessions(userIds)
    clearSelection()
  }
}

async function handleBulkBan() {
  const userIds = getSelectedUserIds()
  if (userIds.length) {
    await bulkBanUsers(userIds)
    clearSelection()
  }
}

async function handleBulkUnban() {
  const userIds = getSelectedUserIds()
  if (userIds.length) {
    await bulkUnbanUsers(userIds)
    clearSelection()
  }
}

async function handleBulkRemove() {
  const ids = [...selectedMemberIds.value]
  for (const id of ids) {
    await handleRemove(id)
  }
  clearSelection()
}

async function handleBulkRoleChange(role: MemberRole) {
  const ids = [...selectedMemberIds.value]
  for (const id of ids) {
    await handleRoleChange(id, role)
  }
  clearSelection()
}

function getSelectedUserIds(): string[] {
  return [...selectedMemberIds.value]
    .map(id => members.value.find(m => m.id === id))
    .filter(Boolean)
    .map(m => m!.userId)
}

function getSelectedEmails(): string[] {
  return [...selectedMemberIds.value]
    .map(id => members.value.find(m => m.id === id))
    .filter(Boolean)
    .map(m => {
      const memberUser = 'user' in m! ? (m as MemberWithUser).user : undefined
      return memberUser?.email
    })
    .filter(Boolean) as string[]
}

// Get dropdown action items for a member
function getMemberActions(member: Member | MemberWithUser) {
  const isSelf = member.userId === user.value?.id
  const isOwnerRole = member.role === 'owner'
  const memberUser = 'user' in member ? (member as MemberWithUser).user : undefined
  const items: DropdownMenuItem[][] = []

  if (isSelf || (isOwnerRole && !isOwner.value)) return items

  // Role change group
  const roleItems = [
    { label: t('teams.member'), icon: 'i-lucide-user', disabled: member.role === 'member', onSelect: () => handleRoleChange(member.id, 'member') },
    { label: t('teams.admin'), icon: 'i-lucide-shield', disabled: member.role === 'admin', onSelect: () => handleRoleChange(member.id, 'admin') }
  ]
  if (isOwner.value && !isSelf) {
    roleItems.push({ label: t('teams.owner'), icon: 'i-lucide-crown', disabled: member.role === 'owner', onSelect: () => handleRoleChange(member.id, 'owner') })
  }
  items.push(roleItems)

  // Admin actions group
  const adminActions = []
  if (memberUser?.email) {
    adminActions.push({ label: t('admin.sendPasswordReset'), icon: 'i-lucide-mail', onSelect: () => sendPasswordReset(memberUser.email) })
  }
  adminActions.push({ label: t('admin.forceLogout'), icon: 'i-lucide-log-out', onSelect: () => revokeUserSessions(member.userId) })

  // Ban/unban
  // `banned` comes from the admin plugin's user fields, absent from the org member's user shape
  const isBanned = (memberUser as { banned?: boolean } | undefined)?.banned
  if (isBanned) {
    adminActions.push({ label: t('admin.unbanUser'), icon: 'i-lucide-shield-check', onSelect: () => unbanUser(member.userId) })
  } else {
    adminActions.push({ label: t('admin.banUser'), icon: 'i-lucide-shield-off', onSelect: () => banUser(member.userId) })
  }

  // Impersonate (owner only)
  if (isOwner.value) {
    adminActions.push({ label: t('admin.impersonate'), icon: 'i-lucide-eye', onSelect: () => impersonateUser(member.userId) })
  }
  items.push(adminActions)

  // Destructive group
  if (!isSelf && !isOwnerRole) {
    items.push([
      { label: t('admin.removeFromTeam'), icon: 'i-lucide-user-x', color: 'error' as const, onSelect: () => handleRemove(member.id) }
    ])
  }

  return items
}

// Sort members: owners first, then admins, then members
const sortedMembers = computed(() => {
  const roleOrder: Record<MemberRole, number> = {
    owner: 0,
    admin: 1,
    member: 2
  }
  return [...members.value].sort((a, b) => roleOrder[a.role] - roleOrder[b.role])
})

// Table columns
const UAvatar = resolveComponent('UAvatar')
const UBadge = resolveComponent('UBadge')
const UButton = resolveComponent('UButton')
const UCheckbox = resolveComponent('UCheckbox')
const UDropdownMenu = resolveComponent('UDropdownMenu')

type MemberRow = Member | MemberWithUser

const columns = computed<TableColumn<MemberRow>[]>(() => {
  const cols: TableColumn<MemberRow>[] = []

  // Checkbox column (only for admins)
  if (canManageMembers.value) {
    cols.push({
      id: 'select',
      header: () => {
        return h(UCheckbox, {
          'modelValue': allSelected.value,
          'indeterminate': selectedMemberIds.value.size > 0 && !allSelected.value,
          'onUpdate:modelValue': () => toggleSelectAll()
        })
      },
      cell: ({ row }) => {
        const member = row.original
        const isSelf = member.userId === user.value?.id
        const isOwnerRole = member.role === 'owner' && !isOwner.value
        if (isSelf || isOwnerRole) return h('div')
        return h(UCheckbox, {
          'modelValue': selectedMemberIds.value.has(member.id),
          'onUpdate:modelValue': () => toggleSelection(member.id)
        })
      }
    })
  }

  cols.push(
    {
      id: 'name',
      header: t('teams.name'),
      cell: ({ row }) => {
        const member = row.original
        const memberUser = 'user' in member ? member.user : undefined
        const displayName = memberUser?.name || memberUser?.email || 'Unknown'
        const initials = (memberUser?.name || memberUser?.email || '?').slice(0, 2).toUpperCase()

        const children = [
          h(UAvatar, {
            src: memberUser?.image,
            text: initials,
            size: 'sm',
            class: 'mr-2'
          }),
          h('span', { class: 'font-medium' }, displayName),
          ...(member.userId === user.value?.id
            ? [h('span', { class: 'text-xs text-muted ml-1' }, `(${t('teams.you')})`)]
            : [])
        ]

        return h('div', { class: 'flex items-center' }, children)
      }
    },
    {
      id: 'email',
      header: t('teams.email'),
      cell: ({ row }) => {
        const member = row.original
        const memberUser = 'user' in member ? member.user : undefined
        return h('span', { class: 'text-sm text-muted' }, memberUser?.email || '')
      }
    },
    {
      id: 'role',
      header: t('teams.role'),
      cell: ({ row }) => {
        const color = ({
          owner: 'primary' as const,
          admin: 'info' as const,
          member: 'neutral' as const
        })[row.original.role]
        return h(UBadge, { color, variant: 'subtle', size: 'xs', class: 'capitalize' }, () => row.original.role)
      }
    }
  )

  if (canManageMembers.value) {
    cols.push({
      id: 'actions',
      header: t('teams.actions'),
      meta: { class: { td: 'text-right', th: 'text-right' } },
      cell: ({ row }) => {
        const member = row.original
        const actionItems = getMemberActions(member)
        if (!actionItems.length) {
          return h('span', { class: 'text-xs text-muted' }, t('teams.noActions'))
        }
        return h('div', { class: 'flex justify-end' }, [
          h(UDropdownMenu, { items: actionItems }, {
            default: () => h(UButton, { icon: 'i-lucide-more-horizontal', variant: 'ghost', color: 'neutral', size: 'xs' })
          })
        ])
      }
    })
  }

  return cols
})
</script>

<template>
  <div class="space-y-6">
    <div class="flex items-center justify-between">
      <div>
        <h3 class="text-lg font-semibold">
          {{ t('teams.teamMembers') }}
        </h3>
        <p class="text-sm text-muted mt-1">
          {{ t('teams.memberCount', { count: members.length }) }}
        </p>
      </div>
      <div class="flex items-center gap-2">
        <div class="flex items-center rounded-md border border-default">
          <UButton
            icon="i-lucide-layout-grid"
            :variant="layout === 'grid' ? 'subtle' : 'ghost'"
            :color="layout === 'grid' ? 'primary' : 'neutral'"
            size="xs"
            @click="layout = 'grid'"
          />
          <UButton
            icon="i-lucide-list"
            :variant="layout === 'table' ? 'subtle' : 'ghost'"
            :color="layout === 'table' ? 'primary' : 'neutral'"
            size="xs"
            @click="layout = 'table'"
          />
        </div>

        <UButton
          v-if="showInviteButton && canInviteMembers"
          icon="i-lucide-user-plus"
          @click="emit('invite')"
        >
          {{ t('teams.invite') }}
        </UButton>
      </div>
    </div>

    <!-- Loading State -->
    <div
      v-if="teamLoading && members.length === 0"
      class="py-8 text-center text-muted"
    >
      <UIcon
        name="i-lucide-loader-2"
        class="size-6 animate-spin mx-auto mb-2"
      />
      <p>{{ t('teams.loadingMembers') }}</p>
    </div>

    <!-- Empty State -->
    <div
      v-else-if="members.length === 0"
      class="py-8 text-center text-muted"
    >
      <UIcon
        name="i-lucide-users"
        class="size-8 mx-auto mb-2"
      />
      <p>{{ t('teams.noMembersFound') }}</p>
    </div>

    <!-- Members Table -->
    <UTable
      v-else-if="layout === 'table'"
      :data="sortedMembers"
      :columns="columns"
      class="flex-1"
    />

    <!-- Members Grid -->
    <div
      v-else
      class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4"
    >
      <div
        v-for="member in sortedMembers"
        :key="member.id"
        class="relative p-4 rounded-lg border border-default bg-elevated hover:bg-muted/50 transition-colors"
        :class="{ 'ring-2 ring-primary': selectedMemberIds.has(member.id) }"
      >
        <!-- Checkbox in top-left corner -->
        <div
          v-if="canManageMembers && member.userId !== user?.id && !(member.role === 'owner' && !isOwner)"
          class="absolute top-3 left-3"
        >
          <UCheckbox
            :model-value="selectedMemberIds.has(member.id)"
            @update:model-value="toggleSelection(member.id)"
          />
        </div>

        <!-- Role badge + actions dropdown in top-right corner -->
        <div class="absolute top-3 right-3 flex items-center gap-1">
          <UBadge
            :color="member.role === 'owner' ? 'primary' : member.role === 'admin' ? 'info' : 'neutral'"
            variant="subtle"
            size="xs"
          >
            {{ member.role }}
          </UBadge>
          <UDropdownMenu
            v-if="canManageMembers && getMemberActions(member).length > 0"
            :items="getMemberActions(member)"
          >
            <UButton
              icon="i-lucide-more-horizontal"
              variant="ghost"
              color="neutral"
              size="xs"
            />
          </UDropdownMenu>
        </div>

        <!-- Member info centered -->
        <div class="flex flex-col items-center text-center pt-2 pb-4">
          <UAvatar
            :src="(member as any).user?.image"
            :text="((member as any).user?.name || (member as any).user?.email || '?').slice(0, 2).toUpperCase()"
            size="xl"
            class="mb-3"
          />
          <div class="font-medium truncate max-w-full">
            {{ (member as any).user?.name || (member as any).user?.email || 'Unknown' }}
            <span v-if="member.userId === user?.id" class="text-xs text-muted">({{ t('teams.you') }})</span>
          </div>
          <div class="text-sm text-muted truncate max-w-full">
            {{ (member as any).user?.email }}
          </div>
        </div>
      </div>
    </div>

    <!-- Bulk Action Bar -->
    <Transition
      enter-active-class="transition-all duration-200 ease-out"
      enter-from-class="translate-y-4 opacity-0"
      enter-to-class="translate-y-0 opacity-100"
      leave-active-class="transition-all duration-150 ease-in"
      leave-from-class="translate-y-0 opacity-100"
      leave-to-class="translate-y-4 opacity-0"
    >
      <div
        v-if="selectedMemberIds.size > 0 && canManageMembers"
        class="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 bg-elevated border border-default rounded-xl shadow-xl px-4 py-3 flex items-center gap-3"
      >
        <span class="text-sm font-medium whitespace-nowrap">
          {{ t('admin.selected', { count: selectedMemberIds.size }) }}
        </span>
        <USeparator orientation="vertical" class="h-6" />
        <div class="flex items-center gap-1">
          <UDropdownMenu
            :items="[
              [
                { label: t('teams.member'), icon: 'i-lucide-user', onSelect: () => handleBulkRoleChange('member') },
                { label: t('teams.admin'), icon: 'i-lucide-shield', onSelect: () => handleBulkRoleChange('admin') }
              ]
            ]"
          >
            <UButton variant="ghost" color="neutral" size="xs" icon="i-lucide-users">
              {{ t('admin.changeRole') }}
            </UButton>
          </UDropdownMenu>
          <UButton variant="ghost" color="neutral" size="xs" icon="i-lucide-mail" :loading="adminLoading" @click="handleBulkPasswordReset">
            {{ t('admin.sendPasswordReset') }}
          </UButton>
          <UButton variant="ghost" color="neutral" size="xs" icon="i-lucide-log-out" :loading="adminLoading" @click="handleBulkForceLogout">
            {{ t('admin.forceLogout') }}
          </UButton>
          <UButton variant="ghost" color="neutral" size="xs" icon="i-lucide-shield-off" :loading="adminLoading" @click="handleBulkBan">
            {{ t('admin.banUser') }}
          </UButton>
          <UButton variant="ghost" color="neutral" size="xs" icon="i-lucide-shield-check" :loading="adminLoading" @click="handleBulkUnban">
            {{ t('admin.unbanUser') }}
          </UButton>
          <USeparator orientation="vertical" class="h-6" />
          <UButton variant="ghost" color="error" size="xs" icon="i-lucide-user-x" @click="handleBulkRemove">
            {{ t('admin.removeFromTeam') }}
          </UButton>
        </div>
        <USeparator orientation="vertical" class="h-6" />
        <UButton variant="ghost" color="neutral" size="xs" icon="i-lucide-x" @click="clearSelection">
          {{ t('admin.deselectAll') }}
        </UButton>
      </div>
    </Transition>
  </div>
</template>
