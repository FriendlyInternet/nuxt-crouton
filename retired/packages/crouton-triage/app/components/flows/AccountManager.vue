<script setup lang="ts">
// @ts-expect-error - layer types resolved at app level
import type { ConnectedAccount, AccountProvider } from '~/layers/triage/types'

/**
 * AccountManager - Team-level connected accounts list
 *
 * Shows all accounts with provider icon, label, status, lastVerifiedAt.
 * Actions: verify, delete, reconnect.
 * "Add Account" per provider.
 */

interface Props {
  teamId: string
}

const props = defineProps<Props>()

const notify = useNotify()
const {
  accounts,
  loading,
  fetchAccounts,
  verifyAccount,
  deleteAccount,
  createManualAccount,
} = useTriageConnectedAccounts(props.teamId)

// Fetch on mount
onMounted(() => {
  fetchAccounts()
})

// Manual connect modal
const showConnectModal = ref(false)
const connectProvider = ref<AccountProvider>('notion')
const connectForm = ref({
  label: '',
  token: '',
})

const verifyingId = ref<string | null>(null)
const deletingId = ref<string | null>(null)

function getProviderIcon(provider: string): string {
  const icons: Record<string, string> = {
    slack: 'i-lucide-slack',
    notion: 'i-simple-icons-notion',
    figma: 'i-lucide-figma',
    github: 'i-lucide-github',
    linear: 'i-simple-icons-linear',
  }
  return icons[provider] || 'i-lucide-link'
}

function getStatusColor(status: string): string {
  switch (status) {
    case 'connected': return 'success'
    case 'expired': return 'warning'
    case 'revoked': return 'error'
    case 'error': return 'error'
    default: return 'neutral'
  }
}

function formatDate(date: Date | string | undefined): string {
  if (!date) return 'Never'
  return new Date(date).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

async function handleVerify(account: ConnectedAccount) {
  verifyingId.value = account.id
  try {
    const result = await verifyAccount(account.id)
    if (result?.success) {
      notify.success('Account Verified', { description: `${account.label} is connected and working.` })
    } else {
      notify.warning('Verification Failed', { description: result?.error || `${account.label} token is no longer valid.` })
    }
  } finally {
    verifyingId.value = null
  }
}

async function handleDelete(account: ConnectedAccount) {
  deletingId.value = account.id
  try {
    await deleteAccount(account.id)
    notify.success('Account Removed', { description: `${account.label} has been disconnected.` })
  } catch (err: any) {
    notify.error('Delete Failed', { description: err.message || 'Failed to remove account.' })
  } finally {
    deletingId.value = null
  }
}

function openConnectModal(provider: AccountProvider) {
  connectProvider.value = provider
  connectForm.value = { label: '', token: '' }
  showConnectModal.value = true
}

async function handleManualConnect() {
  if (!connectForm.value.label || !connectForm.value.token) {
    notify.warning('Missing Fields', { description: 'Please enter a label and token.' })
    return
  }

  try {
    await createManualAccount({
      provider: connectProvider.value,
      label: connectForm.value.label,
      token: connectForm.value.token,
    })

    notify.success('Account Connected', { description: `${connectForm.value.label} has been added.` })

    showConnectModal.value = false
  } catch (err: any) {
    notify.error('Connection Failed', { description: err.message || 'Failed to connect account.' })
  }
}

const addAccountItems = [[
  { label: 'Notion', icon: 'i-simple-icons-notion', onSelect: () => openConnectModal('notion') },
  { label: 'Figma', icon: 'i-lucide-figma', onSelect: () => openConnectModal('figma') },
  { label: 'GitHub', icon: 'i-lucide-github', onSelect: () => openConnectModal('github') },
  { label: 'Linear', icon: 'i-simple-icons-linear', onSelect: () => openConnectModal('linear') },
]]
</script>

<template>
  <div class="space-y-4">
    <!-- Header -->
    <div class="flex items-center justify-between">
      <div>
        <h3 class="text-lg font-semibold">Connected Accounts</h3>
        <p class="text-sm text-gray-500">
          Manage third-party connections shared across flows.
        </p>
      </div>

      <UDropdownMenu :items="addAccountItems">
        <UButton
          icon="i-lucide-plus"
          label="Add Account"
          color="primary"
          size="sm"
        />
      </UDropdownMenu>
    </div>

    <!-- Loading -->
    <div v-if="loading" class="space-y-2">
      <div v-for="i in 2" :key="i" class="animate-pulse flex items-center gap-3 p-3 rounded-lg bg-gray-50 dark:bg-gray-800/50">
        <div class="w-8 h-8 rounded bg-gray-200 dark:bg-gray-700" />
        <div class="flex-1 space-y-2">
          <div class="h-4 bg-gray-200 dark:bg-gray-700 rounded w-1/3" />
          <div class="h-3 bg-gray-200 dark:bg-gray-700 rounded w-1/4" />
        </div>
      </div>
    </div>

    <!-- Empty state -->
    <UAlert
      v-else-if="accounts.length === 0"
      title="No connected accounts"
      description="Connected accounts let you share tokens across multiple flows. Slack accounts are created automatically via OAuth."
      color="info"
      variant="soft"
    />

    <!-- Account list -->
    <div v-else class="space-y-2">
      <div
        v-for="account in accounts"
        :key="account.id"
        class="flex items-center gap-3 p-3 rounded-lg border border-gray-200 dark:border-gray-700"
      >
        <!-- Provider icon -->
        <div class="w-8 h-8 rounded-md bg-gray-100 dark:bg-gray-800 flex items-center justify-center flex-shrink-0">
          <UIcon :name="getProviderIcon(account.provider)" class="w-4 h-4" />
        </div>

        <!-- Account info -->
        <div class="flex-1 min-w-0">
          <div class="flex items-center gap-2">
            <span class="text-sm font-medium truncate">{{ account.label }}</span>
            <UBadge
              :color="getStatusColor(account.status) as any"
              size="xs"
              variant="subtle"
            >
              {{ account.status }}
            </UBadge>
          </div>
          <div class="flex items-center gap-2 text-xs text-gray-500">
            <span v-if="account.accessTokenHint" class="font-mono">{{ account.accessTokenHint }}</span>
            <span v-if="account.lastVerifiedAt">
              Verified {{ formatDate(account.lastVerifiedAt) }}
            </span>
          </div>
        </div>

        <!-- Actions -->
        <div class="flex items-center gap-1">
          <UButton
            icon="i-lucide-shield-check"
            color="neutral"
            variant="ghost"
            size="xs"
            :loading="verifyingId === account.id"
            title="Verify token"
            @click="handleVerify(account)"
          />
          <UButton
            icon="i-lucide-trash-2"
            color="neutral"
            variant="ghost"
            size="xs"
            :loading="deletingId === account.id"
            title="Remove account"
            @click="handleDelete(account)"
          />
        </div>
      </div>
    </div>

    <!-- Manual Connect Modal -->
    <UModal v-model:open="showConnectModal">
      <template #content="{ close }">
        <div class="p-6">
          <h3 class="text-lg font-semibold mb-4">
            Connect {{ connectProvider.charAt(0).toUpperCase() + connectProvider.slice(1) }} Account
          </h3>

          <div class="space-y-4">
            <UFormField label="Label" name="label" required>
              <UInput
                v-model="connectForm.label"
                placeholder="e.g., Design Team Notion"
                class="w-full"
              />
            </UFormField>

            <UFormField label="API Token" name="token" required>
              <UInput
                v-model="connectForm.token"
                type="password"
                placeholder="secret_... or ntn_..."
                class="w-full"
              />
              <template #help>
                Paste your integration token. It will be encrypted at rest.
              </template>
            </UFormField>
          </div>

          <div class="flex justify-end gap-2 mt-6">
            <UButton color="neutral" variant="ghost" @click="close">
              Cancel
            </UButton>
            <UButton color="primary" @click="handleManualConnect">
              Connect
            </UButton>
          </div>
        </div>
      </template>
    </UModal>
  </div>
</template>
