<script setup lang="ts">
import { localizeError } from '../../utils/errors'
/**
 * Team Invitations Component
 *
 * Displays list of pending invitations with actions to cancel.
 * Also shows invitations the current user has received.
 *
 * @example
 * ```vue
 * <TeamInvitations />
 * ```
 */
import { h } from 'vue'
import type { TableColumn } from '@nuxt/ui'
import type { MemberRole } from '../../../types'

interface InvitationData {
  id: string
  organizationId: string
  email: string
  role: MemberRole
  status: 'pending' | 'accepted' | 'rejected' | 'expired'
  expiresAt: string | Date
  inviterId?: string
  inviter?: {
    name?: string | null
    email: string
  }
}

interface Props {
  /** Show pending invitations for current team (admin view) */
  showTeamInvitations?: boolean
  /** Show invitations received by current user */
  showUserInvitations?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  showTeamInvitations: true,
  showUserInvitations: false
})

const { t } = useT()
const {
  currentTeam,
  getPendingInvitations,
  cancelInvitation,
  acceptInvitation,
  rejectInvitation,
  resendInvitation,
  loading: teamLoading
} = useTeam()

const notify = useNotify()

// State
const invitations = ref<InvitationData[]>([])
const loadingInvitationId = ref<string | null>(null)
const isLoading = ref(false)

// Load invitations
async function loadInvitations() {
  if (!props.showTeamInvitations || !currentTeam.value) return

  isLoading.value = true
  try {
    const result = await getPendingInvitations()
    // Filter to only show pending invitations (API returns all statuses)
    invitations.value = (result as InvitationData[]).filter(
      i => i.status === 'pending'
    )
  } catch (e) {
    console.error('Failed to load invitations:', e)
    invitations.value = []
  } finally {
    isLoading.value = false
  }
}

// Load on mount and when team changes
onMounted(loadInvitations)
watch(currentTeam, loadInvitations)

// Handle resend invitation
async function handleResend(invitationId: string) {
  loadingInvitationId.value = invitationId
  try {
    await resendInvitation(invitationId)
    notify.success(t('teams.invitationResent'), { description: t('teams.invitationResentDescription') })
  } catch (e: unknown) {
    const message = e instanceof Error ? localizeError(e, t) : t('teams.failedToResendInvitation')
    notify.error(t('common.error'), { description: message })
  } finally {
    loadingInvitationId.value = null
  }
}

// Handle cancel invitation
async function handleCancel(invitationId: string) {
  loadingInvitationId.value = invitationId
  try {
    await cancelInvitation(invitationId)
    notify.success(t('teams.invitationCancelled'), { description: t('teams.invitationCancelledDescription') })
    invitations.value = invitations.value.filter(i => i.id !== invitationId)
  } catch (e: unknown) {
    const message = localizeError(e, t)
    notify.error(t('common.error'), { description: message })
  } finally {
    loadingInvitationId.value = null
  }
}

// Handle accept invitation (user view)
async function handleAccept(invitationId: string) {
  loadingInvitationId.value = invitationId
  try {
    await acceptInvitation(invitationId)
    notify.success(t('teams.invitationAccepted'), { description: t('teams.invitationAcceptedDescription') })
    invitations.value = invitations.value.filter(i => i.id !== invitationId)
  } catch (e: unknown) {
    const message = localizeError(e, t)
    notify.error(t('common.error'), { description: message })
  } finally {
    loadingInvitationId.value = null
  }
}

// Handle reject invitation (user view)
async function handleReject(invitationId: string) {
  loadingInvitationId.value = invitationId
  try {
    await rejectInvitation(invitationId)
    notify.info(t('teams.invitationDeclined'), { description: t('teams.invitationDeclinedDescription') })
    invitations.value = invitations.value.filter(i => i.id !== invitationId)
  } catch (e: unknown) {
    const message = localizeError(e, t)
    notify.error(t('common.error'), { description: message })
  } finally {
    loadingInvitationId.value = null
  }
}

// Format expiry date
function formatExpiry(date: string | Date): string {
  const d = new Date(date)
  const now = new Date()
  const diffMs = d.getTime() - now.getTime()
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60))
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24))

  if (diffMs < 0) return t('teams.expired')
  if (diffHours < 1) return t('teams.lessThanOneHour')
  if (diffHours < 24) return t('teams.expiresHours', { count: diffHours })
  return t('teams.expiresDays', { count: diffDays })
}

// Role badge color
function roleBadgeColor(role: MemberRole): 'primary' | 'info' | 'neutral' {
  switch (role) {
    case 'owner':
      return 'primary'
    case 'admin':
      return 'info'
    default:
      return 'neutral'
  }
}

// Table columns
const columns = computed<TableColumn<InvitationData>[]>(() => {
  const cols: TableColumn<InvitationData>[] = [
    {
      accessorKey: 'email',
      header: t('teams.email')
    },
    {
      accessorKey: 'role',
      header: t('teams.role'),
      cell: ({ row }) => h(resolveComponent('UBadge'), {
        color: roleBadgeColor(row.original.role),
        variant: 'subtle',
        size: 'xs'
      }, () => row.original.role)
    },
    {
      accessorKey: 'expiresAt',
      header: t('teams.expires'),
      cell: ({ row }) => formatExpiry(row.original.expiresAt)
    },
    {
      accessorKey: 'inviter',
      header: t('teams.invitedBy'),
      cell: ({ row }) => row.original.inviter
        ? (row.original.inviter.name || row.original.inviter.email)
        : '-'
    }
  ]

  // Actions column
  if (props.showTeamInvitations) {
    cols.push({
      id: 'actions',
      header: '',
      cell: ({ row }) => h('div', { class: 'flex justify-end gap-2' }, [
        h(resolveComponent('UButton'), {
          icon: 'i-lucide-mail',
          variant: 'ghost',
          size: 'xs',
          loading: loadingInvitationId.value === row.original.id,
          onClick: () => handleResend(row.original.id)
        }, () => t('teams.resend')),
        h(resolveComponent('UButton'), {
          icon: 'i-lucide-x',
          variant: 'ghost',
          color: 'error',
          size: 'xs',
          loading: loadingInvitationId.value === row.original.id,
          onClick: () => handleCancel(row.original.id)
        }, () => t('common.cancel'))
      ])
    })
  }

  if (props.showUserInvitations) {
    cols.push({
      id: 'actions',
      header: '',
      cell: ({ row }) => h('div', { class: 'flex justify-end gap-2' }, [
        h(resolveComponent('UButton'), {
          icon: 'i-lucide-x',
          variant: 'ghost',
          size: 'xs',
          loading: loadingInvitationId.value === row.original.id,
          onClick: () => handleReject(row.original.id)
        }, () => t('teams.decline')),
        h(resolveComponent('UButton'), {
          icon: 'i-lucide-check',
          size: 'xs',
          loading: loadingInvitationId.value === row.original.id,
          onClick: () => handleAccept(row.original.id)
        }, () => t('teams.accept'))
      ])
    })
  }

  return cols
})
</script>

<template>
  <div class="space-y-4">
    <div class="flex items-center justify-between">
      <div>
        <h3 class="text-lg font-semibold">
          {{ showUserInvitations ? t('teams.yourInvitations') : t('teams.pendingInvitations') }}
        </h3>
        <p class="text-sm text-muted mt-1">
          {{
            showUserInvitations
              ? t('teams.yourInvitationsDescription')
              : t('teams.pendingInvitationsDescription')
          }}
        </p>
      </div>

      <UButton
        v-if="invitations.length > 0"
        variant="ghost"
        size="sm"
        icon="i-lucide-refresh-cw"
        :loading="isLoading"
        @click="loadInvitations"
      >
        {{ t('common.refresh') }}
      </UButton>
    </div>

    <UTable
      :data="invitations"
      :columns="columns"
      :loading="(isLoading || teamLoading) && invitations.length === 0"
    >
      <template #empty>
        <UEmpty
          icon="i-lucide-mail-open"
          :title="t('teams.noPendingInvitations')"
          variant="naked"
          size="sm"
        />
      </template>
    </UTable>
  </div>
</template>
