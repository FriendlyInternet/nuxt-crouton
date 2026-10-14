<script setup lang="ts">
/**
 * NotionUserDiscovery - Side-by-side Notion to Notion user matching
 *
 * Fetches source Notion workspace members and target Notion users,
 * provides auto-matching by email and manual mapping capabilities.
 *
 * Use case: Map users from source Notion workspace to target Notion workspace
 * (these may be different workspaces with different user IDs)
 */

interface NotionUser {
  id: string
  name: string
  email: string | null
  type: 'person' | 'bot'
  avatarUrl: string | null
}

interface SourceUser {
  id: string
  name: string
  email: string | null
  avatar?: string | null
}

interface UserMatch {
  sourceUser: SourceUser
  notionUser: NotionUser
  confidence: number
  matchType: 'email' | 'name' | 'manual'
}

interface Props {
  /** Notion workspace ID (auto-captured from webhook) */
  workspaceId: string
  /** Notion token for fetching users (legacy — prefer notionAccountId) */
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

// For Notion-to-Notion, source and target are the same workspace (using same token)
// So we just use one set of users
const { fetchNotionUsers, users: notionUsers, loading: usersLoading, error: usersError } = useTriageNotionUsers()

// Alias for template compatibility
const sourceUsers = notionUsers
const targetUsers = notionUsers
const sourceLoading = usersLoading
const targetLoading = usersLoading
const sourceError = usersError
const targetError = ref<string | null>(null)

// Auto-matching
const { autoMatchByEmail, addManualMatch, removeMatch, matches, unmatched } = useTriageAutoMatch()

// Loading state
const loading = computed(() => sourceLoading.value || targetLoading.value)
const saving = ref(false)

// Existing mappings from database
const existingMappings = ref<any[]>([])
const loadingMappings = ref(false)

// Editing state
const editingMapping = ref<any | null>(null)
const editingNotionUserId = ref<string | null>(null)
const isEditModalOpen = computed({
  get: () => !!editingMapping.value,
  set: (value) => { if (!value) cancelEdit() }
})

// Fetch existing mappings
async function fetchExistingMappings() {
  loadingMappings.value = true
  try {
    const response = await $fetch<any[]>(`/api/teams/${props.teamId}/triage-users`)
    // Filter by sourceType and sourceWorkspaceId
    existingMappings.value = response.filter(m =>
      m.sourceType === 'notion' && m.sourceWorkspaceId === props.workspaceId
    )
  } catch (err: any) {
    console.error('Failed to fetch existing mappings:', err)
  } finally {
    loadingMappings.value = false
  }
}

// Initialize - fetch all data
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

// Run auto-match by email
function runAutoMatch() {
  if (sourceUsers.value.length === 0 || targetUsers.value.length === 0) {
    notify.warning('Cannot auto-match', { description: 'Need both source and target Notion users loaded' })
    return
  }

  // Filter out already mapped users
  const existingSourceIds = new Set(existingMappings.value.map(m => m.sourceUserId))
  const unmappedSourceUsers = sourceUsers.value.filter(u => !existingSourceIds.has(u.id))

  // Convert to SourceUser format
  const users: SourceUser[] = unmappedSourceUsers.map(u => ({
    id: u.id,
    name: u.name,
    email: u.email,
    avatar: u.avatarUrl
  }))

  const result = autoMatchByEmail(users, targetUsers.value)

  notify.success('Auto-match complete', { description: `Matched ${result.matched.length} users, ${result.unmatched.length} remaining` })
}

// Handle manual match selection
function handleManualMatch(sourceUser: SourceUser, notionUserId: string | null) {
  if (!notionUserId) {
    removeMatch(sourceUser.id)
    return
  }

  const notionUser = targetUsers.value.find(u => u.id === notionUserId)
  if (notionUser) {
    addManualMatch(sourceUser, notionUser)
  }
}

// Save all matches to database
async function saveMatches() {
  if (matches.value.length === 0) {
    notify.warning('No matches to save', { description: 'Use auto-match or manually select users first' })
    return
  }

  saving.value = true
  let saved = 0
  let failed = 0

  for (const match of matches.value) {
    try {
      await $fetch(`/api/teams/${props.teamId}/triage-users`, {
        method: 'POST',
        body: {
          sourceType: 'notion',
          sourceWorkspaceId: props.workspaceId,
          sourceUserId: match.sourceUser.id,
          sourceUserEmail: match.sourceUser.email,
          sourceUserName: match.sourceUser.name,
          notionUserId: match.notionUser.id,
          notionUserEmail: match.notionUser.email,
          notionUserName: match.notionUser.name,
          mappingType: match.matchType,
          confidence: match.confidence,
          active: true
        }
      })
      saved++
    } catch (err: any) {
      console.error('Failed to save mapping:', err)
      failed++
    }
  }

  if (saved > 0) {
    const mappingsColor = saved > 0 && failed === 0 ? 'success' : 'warning'
    if (mappingsColor === 'success') {
      notify.success('Mappings saved', { description: `Saved ${saved} mapping${saved > 1 ? 's' : ''}${failed > 0 ? `, ${failed} failed` : ''}` })
    } else {
      notify.warning('Mappings saved', { description: `Saved ${saved} mapping${saved > 1 ? 's' : ''}${failed > 0 ? `, ${failed} failed` : ''}` })
    }

    // Clear matches and refresh
    matches.value = []
    unmatched.value = []
    await fetchExistingMappings()
    emit('saved')
  } else {
    notify.error('Save failed', { description: 'Could not save any mappings' })
  }

  saving.value = false
}

// Edit existing mapping
function startEditMapping(mapping: any) {
  editingMapping.value = mapping
  editingNotionUserId.value = mapping.notionUserId
}

// Save edited mapping
async function saveEditedMapping() {
  if (!editingMapping.value || !editingNotionUserId.value) return

  const notionUser = targetUsers.value.find(u => u.id === editingNotionUserId.value)

  try {
    await $fetch(`/api/teams/${props.teamId}/triage-users/${editingMapping.value.id}`, {
      method: 'PATCH',
      body: {
        notionUserId: editingNotionUserId.value,
        notionUserName: notionUser?.name,
        notionUserEmail: notionUser?.email,
        mappingType: 'manual',
        confidence: 1.0
      }
    })

    notify.success('Mapping updated')

    editingMapping.value = null
    editingNotionUserId.value = null
    await fetchExistingMappings()
    emit('saved')
  } catch (err: any) {
    console.error('Failed to update mapping:', err)
    notify.error('Update failed', { description: err.message || 'Failed to update mapping' })
  }
}

// Cancel editing
function cancelEdit() {
  editingMapping.value = null
  editingNotionUserId.value = null
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

// Get unmapped source users (not in existing mappings and not in pending matches)
const unmappedSourceUsers = computed(() => {
  const existingSourceIds = new Set(existingMappings.value.map(m => m.sourceUserId))
  const matchedSourceIds = new Set(matches.value.map(m => m.sourceUser.id))
  return sourceUsers.value.filter(u =>
    !existingSourceIds.has(u.id) && !matchedSourceIds.has(u.id)
  )
})

// Initialize on mount
onMounted(initialize)
</script>

<template>
  <div class="notion-user-discovery space-y-6">
    <!-- Header Actions -->
    <div class="flex items-center justify-between">
      <h4 class="font-semibold">Notion User Mappings</h4>
      <div class="flex items-center gap-2">
        <UButton
          color="primary"
          variant="soft"
          size="sm"
          icon="i-lucide-wand-2"
          :disabled="loading || sourceUsers.length === 0 || targetUsers.length === 0"
          @click="runAutoMatch"
        >
          Auto-match by Email
        </UButton>
        <UButton
          color="neutral"
          variant="outline"
          size="sm"
          icon="i-lucide-refresh-cw"
          :loading="loading"
          @click="initialize"
        >
          Refresh
        </UButton>
      </div>
    </div>

    <!-- Error states -->
    <UAlert
      v-if="sourceError"
      color="error"
      variant="soft"
      icon="i-lucide-alert-circle"
      title="Source Workspace Error"
      :description="sourceError"
    />
    <UAlert
      v-if="targetError"
      color="error"
      variant="soft"
      icon="i-lucide-alert-circle"
      title="Target Workspace Error"
      :description="targetError"
    />

    <!-- Loading state -->
    <div v-if="loading" class="flex items-center justify-center py-12">
      <UIcon name="i-lucide-loader-2" class="w-8 h-8 animate-spin text-primary" />
    </div>

    <!-- Content -->
    <template v-else>
      <!-- Stats -->
      <div class="grid grid-cols-2 gap-4">
        <UCard class="text-center">
          <div class="text-2xl font-bold text-primary">{{ notionUsers.length }}</div>
          <div class="text-sm text-muted">Workspace Users</div>
        </UCard>
        <UCard class="text-center">
          <div class="text-2xl font-bold text-success">{{ existingMappings.length }}</div>
          <div class="text-sm text-muted">Mapped</div>
        </UCard>
      </div>

      <!-- Pending Matches (to be saved) -->
      <div v-if="matches.length > 0" class="space-y-3">
        <div class="flex items-center justify-between">
          <div class="flex items-center gap-2">
            <UIcon name="i-lucide-check-circle" class="w-5 h-5 text-success" />
            <h5 class="font-medium">Pending Matches ({{ matches.length }})</h5>
          </div>
          <UButton
            color="primary"
            size="sm"
            icon="i-lucide-save"
            :loading="saving"
            @click="saveMatches"
          >
            Save All Matches
          </UButton>
        </div>

        <div class="space-y-2">
          <div
            v-for="match in matches"
            :key="match.sourceUser.id"
            class="flex items-center gap-3 p-3 rounded-lg border border-success-200 dark:border-success-800 bg-success-50 dark:bg-success-950"
          >
            <!-- Source user -->
            <div class="flex items-center gap-2 flex-1 min-w-0">
              <UIcon name="i-simple-icons-notion" class="w-5 h-5 flex-shrink-0" />
              <div class="min-w-0">
                <p class="font-medium truncate">{{ match.sourceUser.name }}</p>
                <p v-if="match.sourceUser.email" class="text-xs text-muted truncate">
                  {{ match.sourceUser.email }}
                </p>
              </div>
            </div>

            <div class="flex items-center gap-2 flex-shrink-0">
              <UBadge :color="match.matchType === 'email' ? 'success' : 'neutral'" variant="soft" size="xs">
                {{ match.matchType }}
              </UBadge>
              <UIcon name="i-lucide-arrow-right" class="w-4 h-4 text-muted" />
            </div>

            <!-- Target user -->
            <div class="flex items-center gap-2 flex-1 min-w-0">
              <UAvatar
                v-if="match.notionUser.avatarUrl"
                :src="match.notionUser.avatarUrl"
                size="xs"
              />
              <UIcon v-else name="i-simple-icons-notion" class="w-5 h-5 flex-shrink-0" />
              <div class="min-w-0">
                <p class="font-medium truncate">{{ match.notionUser.name }}</p>
                <p v-if="match.notionUser.email" class="text-xs text-muted truncate">
                  {{ match.notionUser.email }}
                </p>
              </div>
            </div>

            <!-- Remove -->
            <UButton
              color="neutral"
              variant="ghost"
              size="xs"
              icon="i-lucide-x"
              @click="removeMatch(match.sourceUser.id)"
            />
          </div>
        </div>
      </div>

      <!-- Unmapped Source Users -->
      <div v-if="unmappedSourceUsers.length > 0" class="space-y-3">
        <div class="flex items-center gap-2">
          <UIcon name="i-lucide-users" class="w-5 h-5 text-warning" />
          <h5 class="font-medium">Unmapped Users ({{ unmappedSourceUsers.length }})</h5>
        </div>

        <div class="space-y-2">
          <div
            v-for="user in unmappedSourceUsers"
            :key="user.id"
            class="flex items-center gap-3 p-3 rounded-lg border border-default bg-default"
          >
            <!-- Source user -->
            <div class="flex items-center gap-2 flex-1 min-w-0">
              <UAvatar
                v-if="user.avatarUrl"
                :src="user.avatarUrl"
                size="xs"
              />
              <UIcon v-else name="i-simple-icons-notion" class="w-5 h-5 flex-shrink-0" />
              <div class="min-w-0">
                <p class="font-medium truncate">{{ user.name }}</p>
                <p v-if="user.email" class="text-xs text-muted truncate">
                  {{ user.email }}
                </p>
              </div>
            </div>

            <UIcon name="i-lucide-arrow-right" class="w-4 h-4 text-muted flex-shrink-0" />

            <!-- Target user picker -->
            <div class="flex-1">
              <CroutonTriageUsermappingsNotionUserPicker
                :notion-token="notionToken"
                :notion-account-id="notionAccountId"
                :team-id="teamId"
                placeholder="Select target user..."
                size="sm"
                @select="(notionUser: NotionUser | null) => handleManualMatch(user, notionUser?.id || null)"
              />
            </div>
          </div>
        </div>
      </div>

      <!-- Existing Mappings -->
      <div v-if="existingMappings.length > 0" class="space-y-3">
        <h5 class="font-medium">Existing Mappings ({{ existingMappings.length }})</h5>
        <CroutonTriageUsermappingsUserMappingTable
          :mappings="existingMappings"
          :loading="loadingMappings"
          compact
          @edit="startEditMapping"
          @delete="deleteMapping"
        />
      </div>

      <!-- Edit Modal -->
      <UModal v-model:open="isEditModalOpen">
        <template #content>
          <div class="p-6 space-y-4">
            <h3 class="font-semibold">Edit Mapping</h3>

            <div v-if="editingMapping" class="space-y-4">
              <div class="p-3 rounded-lg bg-muted/50">
                <p class="text-sm text-muted">Source User</p>
                <p class="font-medium">{{ editingMapping.sourceUserName || editingMapping.sourceUserId }}</p>
                <p v-if="editingMapping.sourceUserEmail" class="text-sm text-muted">
                  {{ editingMapping.sourceUserEmail }}
                </p>
              </div>

              <UFormField label="Target Notion User">
                <CroutonTriageUsermappingsNotionUserPicker
                  v-model="editingNotionUserId"
                  :notion-token="notionToken"
                  :notion-account-id="notionAccountId"
                  :team-id="teamId"
                />
              </UFormField>
            </div>

            <div class="flex justify-end gap-2">
              <UButton color="neutral" variant="ghost" @click="cancelEdit">
                Cancel
              </UButton>
              <UButton color="primary" :disabled="!editingNotionUserId" @click="saveEditedMapping">
                Save
              </UButton>
            </div>
          </div>
        </template>
      </UModal>

      <!-- Empty state -->
      <div
        v-if="sourceUsers.length === 0 && !loading"
        class="text-center py-8 text-muted"
      >
        <UIcon name="i-simple-icons-notion" class="w-12 h-12 mx-auto mb-3 opacity-30" />
        <p>No users found in source workspace</p>
        <p class="text-sm mt-1">Make sure the Notion token has access to workspace users</p>
      </div>
    </template>
  </div>
</template>
