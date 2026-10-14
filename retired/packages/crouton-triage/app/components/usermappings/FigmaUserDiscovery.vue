<script setup lang="ts">
/**
 * FigmaUserDiscovery - Bootstrap instructions + manual entry for Figma users
 *
 * Since Figma doesn't have a user listing API, this component provides:
 * 1. Instructions for the bootstrap comment trick
 * 2. Display of discovered users (from bootstrap comments)
 * 3. Manual entry fallback
 */

interface NotionUser {
  id: string
  name: string
  email: string | null
  type: 'person' | 'bot'
  avatarUrl: string | null
}

interface Props {
  /** Figma workspace ID (email slug) */
  workspaceId: string
  /** Notion token (legacy — prefer notionAccountId) */
  notionToken?: string
  /** Connected account ID for Notion token resolution */
  notionAccountId?: string
  /** Team ID */
  teamId: string
}

const props = defineProps<Props>()

const emit = defineEmits<{
  saved: []
}>()

const notify = useNotify()

// Notion users
const { fetchNotionUsers, users: notionUsers, loading: notionLoading, error: notionError } = useTriageNotionUsers()

// State
const saving = ref(false)
const existingMappings = ref<any[]>([])
const discoveredMappings = ref<any[]>([]) // Pending mappings from bootstrap
const loadingMappings = ref(false)

// Manual entry form
const manualForm = reactive({
  sourceUserId: '',
  sourceUserEmail: '',
  sourceUserName: '',
  notionUserId: ''
})

// Editing state
const editingMappingId = ref<string | null>(null)

// Fetch existing mappings
async function fetchExistingMappings() {
  loadingMappings.value = true
  try {
    const response = await $fetch<any[]>(`/api/teams/${props.teamId}/triage-users`)

    // Filter by sourceType and sourceWorkspaceId
    const allMappings = response.filter(m =>
      m.sourceType === 'figma' && m.sourceWorkspaceId === props.workspaceId
    )

    // Separate discovered (pending) from existing
    discoveredMappings.value = allMappings.filter(m => !m.notionUserId)
    existingMappings.value = allMappings.filter(m => m.notionUserId)
  } catch (err: any) {
    console.error('Failed to fetch existing mappings:', err)
  } finally {
    loadingMappings.value = false
  }
}

// Initialize
async function initialize() {
  await Promise.all([
    fetchNotionUsers({
      notionToken: props.notionToken,
      accountId: props.notionAccountId,
      teamId: props.teamId,
    }),
    fetchExistingMappings()
  ])
}

// Save mapping for a discovered user
async function saveDiscoveredMapping(mapping: any, notionUserId: string) {
  if (!notionUserId) {
    notify.warning('Select a Notion user')
    return
  }

  const notionUser = notionUsers.value.find(u => u.id === notionUserId)

  try {
    await $fetch(`/api/teams/${props.teamId}/triage-users/${mapping.id}`, {
      method: 'PATCH',
      body: {
        notionUserId,
        notionUserName: notionUser?.name,
        notionUserEmail: notionUser?.email,
        mappingType: 'manual',
        confidence: 1.0,
        active: true
      }
    })

    notify.success('Mapping saved', { description: `${mapping.sourceUserName || mapping.sourceUserId} mapped to ${notionUser?.name}` })

    await fetchExistingMappings()
    emit('saved')
  } catch (err: any) {
    console.error('Failed to save mapping:', err)
    notify.error('Save failed', { description: err.message || 'Failed to save mapping' })
  }
}

// Edit existing mapping - populate form with mapping data
function editMapping(mapping: any) {
  editingMappingId.value = mapping.id
  manualForm.sourceUserId = mapping.sourceUserId || ''
  manualForm.sourceUserEmail = mapping.sourceUserEmail || ''
  manualForm.sourceUserName = mapping.sourceUserName || ''
  manualForm.notionUserId = mapping.notionUserId || ''
}

// Cancel editing
function cancelEdit() {
  editingMappingId.value = null
  manualForm.sourceUserId = ''
  manualForm.sourceUserEmail = ''
  manualForm.sourceUserName = ''
  manualForm.notionUserId = ''
}

// Add or update manual mapping
async function addManualMapping() {
  if (!manualForm.sourceUserId && !manualForm.sourceUserEmail) {
    notify.warning('Enter user info', { description: 'Provide at least a Figma user ID or email' })
    return
  }

  if (!manualForm.notionUserId) {
    notify.warning('Select Notion user')
    return
  }

  saving.value = true
  const notionUser = notionUsers.value.find(u => u.id === manualForm.notionUserId)
  const isEditing = !!editingMappingId.value

  try {
    if (isEditing) {
      // Update existing mapping
      await $fetch(`/api/teams/${props.teamId}/triage-users/${editingMappingId.value}`, {
        method: 'PATCH',
        body: {
          sourceUserId: manualForm.sourceUserId || manualForm.sourceUserEmail,
          sourceUserEmail: manualForm.sourceUserEmail || null,
          sourceUserName: manualForm.sourceUserName || null,
          notionUserId: manualForm.notionUserId,
          notionUserName: notionUser?.name,
          notionUserEmail: notionUser?.email,
          mappingType: 'manual',
          confidence: 1.0,
          active: true
        }
      })

      notify.success('Mapping updated')
    } else {
      // Create new mapping
      await $fetch(`/api/teams/${props.teamId}/triage-users`, {
        method: 'POST',
        body: {
          sourceType: 'figma',
          sourceWorkspaceId: props.workspaceId,
          sourceUserId: manualForm.sourceUserId || manualForm.sourceUserEmail,
          sourceUserEmail: manualForm.sourceUserEmail || null,
          sourceUserName: manualForm.sourceUserName || null,
          notionUserId: manualForm.notionUserId,
          notionUserName: notionUser?.name,
          notionUserEmail: notionUser?.email,
          mappingType: 'manual',
          confidence: 1.0,
          active: true
        }
      })

      notify.success('Mapping created')
    }

    // Reset form
    editingMappingId.value = null
    manualForm.sourceUserId = ''
    manualForm.sourceUserEmail = ''
    manualForm.sourceUserName = ''
    manualForm.notionUserId = ''

    await fetchExistingMappings()
    emit('saved')
  } catch (err: any) {
    console.error('Failed to save mapping:', err)
    notify.error(isEditing ? 'Update failed' : 'Create failed', { description: err.message || 'Failed to save mapping' })
  } finally {
    saving.value = false
  }
}

// Delete mapping
async function deleteMapping(mapping: any) {
  try {
    await $fetch(`/api/teams/${props.teamId}/triage-users/${mapping.id}`, {
      method: 'DELETE'
    })

    notify.info('Mapping deleted')

    await fetchExistingMappings()
  } catch (err: any) {
    console.error('Failed to delete mapping:', err)
    notify.error('Delete failed', { description: err.message || 'Failed to delete mapping' })
  }
}

// Copy bootstrap command
function copyBootstrapCommand() {
  const command = '@yourbot User Sync: @user1 @user2 @user3'
  navigator.clipboard.writeText(command)
  notify.success('Copied!', { description: 'Replace @yourbot with your bot\'s Figma name, then add team members' })
}

// Initialize on mount
onMounted(initialize)
</script>

<template>
  <div class="figma-user-discovery space-y-6">
    <!-- Header Actions -->
    <div class="flex items-center justify-between">
      <h4 class="font-semibold">Discover Figma Users</h4>
      <UButton
        color="neutral"
        variant="outline"
        size="sm"
        icon="i-lucide-refresh-cw"
        :loading="loadingMappings || notionLoading"
        @click="initialize"
      >
        Refresh
      </UButton>
    </div>

    <!-- Error state -->
    <UAlert
      v-if="notionError"
      color="error"
      variant="soft"
      icon="i-lucide-alert-circle"
      title="Notion Error"
      :description="notionError"
    />

    <!-- Bootstrap Instructions -->
    <UCard>
      <template #header>
        <div class="flex items-center gap-2">
          <UIcon name="i-lucide-sparkles" class="w-5 h-5 text-primary" />
          <h5 class="font-medium">Option 1: Bootstrap Comment Discovery</h5>
        </div>
      </template>

      <div class="space-y-4">
        <UAlert
          color="info"
          variant="soft"
          icon="i-lucide-info"
          description="Figma doesn't have a user listing API. Use the bootstrap trick to discover team members."
        />

        <div class="space-y-2">
          <p class="text-sm text-muted">
            Post a comment in your Figma file with this format:
          </p>

          <div class="flex items-center gap-2">
            <code class="flex-1 p-3 rounded-lg bg-gray-100 dark:bg-gray-900 font-mono text-sm">
              @yourbot User Sync: @alice @bob @charlie
            </code>
            <UButton
              color="neutral"
              variant="outline"
              size="sm"
              icon="i-lucide-copy"
              @click="copyBootstrapCommand"
            >
              Copy
            </UButton>
          </div>

          <div class="text-xs text-muted space-y-1">
            <p><strong>@yourbot</strong> — First mention your bot (triggers the webhook)</p>
            <p><strong>User Sync:</strong> — This keyword indicates a bootstrap comment</p>
            <p><strong>@alice @bob</strong> — Users listed after will be discovered</p>
          </div>
        </div>
      </div>
    </UCard>

    <!-- Discovered Users (from bootstrap) -->
    <div v-if="discoveredMappings.length > 0" class="space-y-3">
      <div class="flex items-center gap-2">
        <UIcon name="i-lucide-users" class="w-5 h-5 text-warning" />
        <h5 class="font-medium text-warning-600">Discovered Users ({{ discoveredMappings.length }})</h5>
      </div>

      <div class="space-y-2">
        <div
          v-for="mapping in discoveredMappings"
          :key="mapping.id"
          class="flex items-center gap-3 p-3 rounded-lg border border-warning-200 dark:border-warning-800 bg-warning-50 dark:bg-warning-950"
        >
          <!-- Figma user -->
          <div class="flex items-center gap-2 flex-1 min-w-0">
            <UIcon name="i-lucide-figma" class="w-5 h-5 flex-shrink-0" />
            <div class="min-w-0">
              <p class="font-medium truncate">
                {{ mapping.sourceUserName || mapping.sourceUserId }}
              </p>
              <p v-if="mapping.sourceUserEmail" class="text-xs text-muted truncate">
                {{ mapping.sourceUserEmail }}
              </p>
            </div>
          </div>

          <UIcon name="i-lucide-arrow-right" class="w-4 h-4 text-muted flex-shrink-0" />

          <!-- Notion user picker -->
          <div class="flex-1">
            <CroutonTriageUsermappingsNotionUserPicker
              :notion-token="notionToken"
              :notion-account-id="notionAccountId"
              :team-id="teamId"
              placeholder="Select Notion user..."
              size="sm"
              @select="(notionUser: NotionUser | null) => notionUser && saveDiscoveredMapping(mapping, notionUser.id)"
            />
          </div>

          <!-- Delete button -->
          <UButton
            color="error"
            variant="ghost"
            size="xs"
            icon="i-lucide-trash"
            @click="deleteMapping(mapping)"
          />
        </div>
      </div>
    </div>

    <!-- Manual Entry -->
    <UCard :class="{ 'ring-2 ring-primary': editingMappingId }">
      <template #header>
        <div class="flex items-center justify-between">
          <div class="flex items-center gap-2">
            <UIcon :name="editingMappingId ? 'i-lucide-pencil' : 'i-lucide-edit'" class="w-5 h-5 text-primary" />
            <h5 class="font-medium">{{ editingMappingId ? 'Edit Mapping' : 'Option 2: Manual Entry' }}</h5>
          </div>
          <UButton
            v-if="editingMappingId"
            color="neutral"
            variant="ghost"
            size="xs"
            icon="i-lucide-x"
            @click="cancelEdit"
          >
            Cancel
          </UButton>
        </div>
      </template>

      <div class="space-y-4">
        <p class="text-sm text-muted">
          {{ editingMappingId ? 'Update the Notion user for this mapping.' : 'Add user mappings manually if you know the Figma user ID or email.' }}
        </p>

        <div class="grid grid-cols-2 gap-4">
          <UFormField label="Figma User ID" hint="From @[id:name] format">
            <UInput
              v-model="manualForm.sourceUserId"
              placeholder="123456789"
            />
          </UFormField>

          <UFormField label="Figma Email">
            <UInput
              v-model="manualForm.sourceUserEmail"
              type="email"
              placeholder="designer@company.com"
            />
          </UFormField>

          <UFormField label="Display Name">
            <UInput
              v-model="manualForm.sourceUserName"
              placeholder="John Designer"
            />
          </UFormField>

          <UFormField label="Notion User">
            <CroutonTriageUsermappingsNotionUserPicker
              v-model="manualForm.notionUserId"
              :notion-token="notionToken"
              :notion-account-id="notionAccountId"
              :team-id="teamId"
            />
          </UFormField>
        </div>

        <div class="flex justify-end">
          <UButton
            color="primary"
            :icon="editingMappingId ? 'i-lucide-check' : 'i-lucide-plus'"
            :loading="saving"
            :disabled="(!manualForm.sourceUserId && !manualForm.sourceUserEmail) || !manualForm.notionUserId"
            @click="addManualMapping"
          >
            {{ editingMappingId ? 'Update Mapping' : 'Add Mapping' }}
          </UButton>
        </div>
      </div>
    </UCard>

    <!-- Existing Mappings -->
    <div v-if="existingMappings.length > 0" class="space-y-3">
      <h5 class="font-medium">Existing Mappings ({{ existingMappings.length }})</h5>
      <CroutonTriageUsermappingsUserMappingTable
        :mappings="existingMappings"
        :loading="loadingMappings"
        compact
        @edit="editMapping"
        @delete="deleteMapping"
      />
    </div>

    <!-- Empty state -->
    <div
      v-if="existingMappings.length === 0 && discoveredMappings.length === 0 && !loadingMappings"
      class="text-center py-8 text-muted"
    >
      <UIcon name="i-lucide-figma" class="w-12 h-12 mx-auto mb-3 opacity-30" />
      <p>No Figma user mappings yet</p>
      <p class="text-sm mt-1">Use the bootstrap comment or add mappings manually</p>
    </div>
  </div>
</template>
