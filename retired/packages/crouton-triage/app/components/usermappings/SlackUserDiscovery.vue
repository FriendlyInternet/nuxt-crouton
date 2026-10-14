<script setup lang="ts">
/**
 * SlackUserDiscovery - Side-by-side Slack to Notion user matching
 *
 * Fetches Slack workspace members and Notion users, provides auto-matching
 * by email and manual mapping capabilities.
 */

interface SlackUser {
  id: string
  name: string
  email: string | null
  avatar: string | null
  realName: string | null
}

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
  realName?: string | null
}

interface UserMatch {
  sourceUser: SourceUser
  notionUser: NotionUser
  confidence: number
  matchType: 'email' | 'name' | 'manual'
}

interface Props {
  /** Slack workspace ID */
  workspaceId: string
  /** Slack bot token (legacy — prefer slackAccountId) */
  apiToken?: string
  /** Connected account ID for Slack token resolution */
  slackAccountId?: string
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

// Composables
const { fetchSlackUsers, users: slackUsers, loading: slackLoading, error: slackError } = useTriageSlackUsers()
const { fetchNotionUsers, users: notionUsers, loading: notionLoading, error: notionError } = useTriageNotionUsers()
const { autoMatchByEmail, addManualMatch, removeMatch, matches, unmatched } = useTriageAutoMatch()

// Loading state
const loading = computed(() => slackLoading.value || notionLoading.value)
const saving = ref(false)

// Existing mappings from database
const existingMappings = ref<any[]>([])
const loadingMappings = ref(false)

// Editing state
const editingMapping = ref<any | null>(null)
const editingNotionUserId = ref<string | null>(null)

// Fetch existing mappings
async function fetchExistingMappings() {
  loadingMappings.value = true
  try {
    const response = await $fetch<any[]>(`/api/teams/${props.teamId}/triage-users`)
    // Filter by sourceType and sourceWorkspaceId
    existingMappings.value = response.filter(m =>
      m.sourceType === 'slack' && m.sourceWorkspaceId === props.workspaceId
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
    fetchSlackUsers({
      slackToken: props.apiToken,
      accountId: props.slackAccountId,
      teamId: props.teamId,
    }),
    fetchNotionUsers({
      notionToken: props.notionToken,
      accountId: props.notionAccountId,
      teamId: props.teamId,
    }),
    fetchExistingMappings()
  ])
}

// Run auto-match
function runAutoMatch() {
  if (slackUsers.value.length === 0 || notionUsers.value.length === 0) {
    notify.warning('Cannot auto-match', { description: 'Need both Slack and Notion users loaded' })
    return
  }

  // Filter out already mapped users
  const existingSourceIds = new Set(existingMappings.value.map(m => m.sourceUserId))
  const unmappedSlackUsers = slackUsers.value.filter(u => !existingSourceIds.has(u.id))

  // Convert to SourceUser format
  const sourceUsers: SourceUser[] = unmappedSlackUsers.map(u => ({
    id: u.id,
    name: u.name,
    email: u.email,
    avatar: u.avatar,
    realName: u.realName
  }))

  const result = autoMatchByEmail(sourceUsers, notionUsers.value)

  notify.success('Auto-match complete', { description: `Matched ${result.matched.length} users, ${result.unmatched.length} remaining` })
}

// Handle manual match selection
function handleManualMatch(sourceUser: SourceUser, notionUserId: string | null) {
  if (!notionUserId) {
    removeMatch(sourceUser.id)
    return
  }

  const notionUser = notionUsers.value.find(u => u.id === notionUserId)
  if (notionUser) {
    addManualMatch(sourceUser, notionUser)
  }
}

// Save all matches to database
async function saveMatches() {
  if (matches.value.length === 0) {
    notify.warning('No matches to save', { description: 'Match some users first' })
    return
  }

  saving.value = true
  let savedCount = 0

  try {
    for (const match of matches.value) {
      await $fetch(`/api/teams/${props.teamId}/triage-users`, {
        method: 'POST',
        body: {
          sourceType: 'slack',
          sourceWorkspaceId: props.workspaceId,
          sourceUserId: match.sourceUser.id,
          sourceUserEmail: match.sourceUser.email,
          sourceUserName: match.sourceUser.realName || match.sourceUser.name,
          notionUserId: match.notionUser.id,
          notionUserName: match.notionUser.name,
          notionUserEmail: match.notionUser.email,
          mappingType: match.matchType,
          confidence: match.confidence,
          active: true
        }
      })
      savedCount++
    }

    notify.success('Mappings saved', { description: `Saved ${savedCount} user mappings` })

    // Refresh existing mappings and clear matches
    await fetchExistingMappings()
    matches.value = []
    unmatched.value = []

    emit('saved')
  } catch (err: any) {
    console.error('Failed to save mappings:', err)
    notify.error('Save failed', { description: err.message || 'Failed to save user mappings' })
  } finally {
    saving.value = false
  }
}

// Delete existing mapping
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

// Edit existing mapping
function editMappingStart(mapping: any) {
  editingMapping.value = mapping
  editingNotionUserId.value = mapping.notionUserId
}

// Cancel editing
function cancelEdit() {
  editingMapping.value = null
  editingNotionUserId.value = null
}

// Save edited mapping
async function saveEditedMapping() {
  if (!editingMapping.value || !editingNotionUserId.value) return

  saving.value = true
  const notionUser = notionUsers.value.find(u => u.id === editingNotionUserId.value)

  try {
    await $fetch(`/api/teams/${props.teamId}/triage-users/${editingMapping.value.id}`, {
      method: 'PATCH',
      body: {
        notionUserId: editingNotionUserId.value,
        notionUserName: notionUser?.name,
        notionUserEmail: notionUser?.email,
        mappingType: 'manual',
        confidence: 1.0,
        active: true
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
  } finally {
    saving.value = false
  }
}

// Initialize on mount
onMounted(initialize)
</script>

<template>
  <div class="slack-user-discovery space-y-6">
    <!-- Header Actions -->
    <div class="flex items-center justify-between">
      <h4 class="font-semibold">Discover Slack Users</h4>
      <div class="flex gap-2">
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
        <UButton
          color="primary"
          variant="soft"
          size="sm"
          icon="i-lucide-sparkles"
          :disabled="loading || slackUsers.length === 0 || notionUsers.length === 0"
          @click="runAutoMatch"
        >
          Auto-Match by Email
        </UButton>
      </div>
    </div>

    <!-- Error states -->
    <UAlert
      v-if="slackError"
      color="error"
      variant="soft"
      icon="i-lucide-alert-circle"
      :title="slackError.includes('re-authorization') ? 'Re-authorization Required' : 'Slack Error'"
      :description="slackError"
    >
      <template v-if="slackError.includes('re-authorization')" #actions>
        <UButton color="primary" size="xs">
          Re-authorize Slack
        </UButton>
      </template>
    </UAlert>

    <UAlert
      v-if="notionError"
      color="error"
      variant="soft"
      icon="i-lucide-alert-circle"
      title="Notion Error"
      :description="notionError"
    />

    <!-- Loading state -->
    <div v-if="loading" class="text-center py-8 text-muted">
      <UIcon name="i-lucide-loader-2" class="w-8 h-8 mx-auto mb-3 animate-spin" />
      <p>Loading users...</p>
    </div>

    <!-- Main content -->
    <template v-else>
      <!-- Stats -->
      <div class="grid grid-cols-3 gap-4">
        <div class="p-4 rounded-lg bg-gray-50 dark:bg-gray-900 text-center">
          <p class="text-2xl font-bold">{{ slackUsers.length }}</p>
          <p class="text-sm text-muted">Slack Users</p>
        </div>
        <div class="p-4 rounded-lg bg-gray-50 dark:bg-gray-900 text-center">
          <p class="text-2xl font-bold">{{ notionUsers.length }}</p>
          <p class="text-sm text-muted">Notion Users</p>
        </div>
        <div class="p-4 rounded-lg bg-gray-50 dark:bg-gray-900 text-center">
          <p class="text-2xl font-bold">{{ existingMappings.length }}</p>
          <p class="text-sm text-muted">Mapped</p>
        </div>
      </div>

      <!-- Pending Matches (to be saved) -->
      <div v-if="matches.length > 0" class="space-y-3">
        <div class="flex items-center justify-between">
          <h5 class="font-medium text-success-600">Pending Matches ({{ matches.length }})</h5>
          <UButton
            color="success"
            size="sm"
            icon="i-lucide-save"
            :loading="saving"
            @click="saveMatches"
          >
            Save All
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
              <UAvatar v-if="match.sourceUser.avatar" :src="match.sourceUser.avatar" size="sm" />
              <UIcon v-else name="i-lucide-user" class="w-8 h-8 text-muted" />
              <div class="min-w-0">
                <p class="font-medium truncate">{{ match.sourceUser.realName || match.sourceUser.name }}</p>
                <p v-if="match.sourceUser.email" class="text-xs text-muted truncate">{{ match.sourceUser.email }}</p>
              </div>
            </div>

            <!-- Match indicator -->
            <div class="flex items-center gap-2">
              <UBadge
                :color="match.matchType === 'email' ? 'success' : 'neutral'"
                variant="soft"
                size="xs"
              >
                {{ match.matchType === 'email' ? 'Email Match' : 'Manual' }}
              </UBadge>
              <UIcon name="i-lucide-arrow-right" class="w-4 h-4 text-muted" />
            </div>

            <!-- Notion user -->
            <div class="flex items-center gap-2 flex-1 min-w-0">
              <UAvatar v-if="match.notionUser.avatarUrl" :src="match.notionUser.avatarUrl" size="sm" />
              <UIcon v-else name="i-simple-icons-notion" class="w-8 h-8 text-muted" />
              <div class="min-w-0">
                <p class="font-medium truncate">{{ match.notionUser.name }}</p>
                <p v-if="match.notionUser.email" class="text-xs text-muted truncate">{{ match.notionUser.email }}</p>
              </div>
            </div>

            <!-- Remove button -->
            <UButton
              color="error"
              variant="ghost"
              size="xs"
              icon="i-lucide-x"
              @click="removeMatch(match.sourceUser.id)"
            />
          </div>
        </div>
      </div>

      <!-- Unmatched Users -->
      <div v-if="unmatched.length > 0" class="space-y-3">
        <h5 class="font-medium text-warning-600">Unmatched Users ({{ unmatched.length }})</h5>

        <div class="space-y-2">
          <div
            v-for="user in unmatched"
            :key="user.id"
            class="flex items-center gap-3 p-3 rounded-lg border border-warning-200 dark:border-warning-800 bg-warning-50 dark:bg-warning-950"
          >
            <!-- Source user -->
            <div class="flex items-center gap-2 flex-1 min-w-0">
              <UAvatar v-if="user.avatar" :src="user.avatar" size="sm" />
              <UIcon v-else name="i-lucide-user" class="w-8 h-8 text-muted" />
              <div class="min-w-0">
                <p class="font-medium truncate">{{ user.realName || user.name }}</p>
                <p v-if="user.email" class="text-xs text-muted truncate">{{ user.email }}</p>
              </div>
            </div>

            <UIcon name="i-lucide-arrow-right" class="w-4 h-4 text-muted" />

            <!-- Notion user picker -->
            <div class="flex-1">
              <CroutonTriageUsermappingsNotionUserPicker
                :notion-token="notionToken"
                :notion-account-id="notionAccountId"
                :team-id="teamId"
                placeholder="Select Notion user..."
                size="sm"
                @select="(notionUser: NotionUser | null) => handleManualMatch(user, notionUser?.id || null)"
              />
            </div>
          </div>
        </div>
      </div>

      <!-- Editing inline section -->
      <div v-if="editingMapping" class="space-y-3">
        <div class="flex items-center justify-between">
          <h5 class="font-medium text-primary">Edit Mapping</h5>
          <UButton
            color="neutral"
            variant="ghost"
            size="xs"
            icon="i-lucide-x"
            @click="cancelEdit"
          >
            Cancel
          </UButton>
        </div>

        <div class="flex items-center gap-3 p-4 rounded-lg border-2 border-primary bg-primary-50 dark:bg-primary-950">
          <!-- Source user (read-only) -->
          <div class="flex items-center gap-2 flex-1 min-w-0">
            <UIcon name="i-lucide-slack" class="w-5 h-5 flex-shrink-0" />
            <div class="min-w-0">
              <p class="font-medium truncate">
                {{ editingMapping.sourceUserName || editingMapping.sourceUserId }}
              </p>
              <p v-if="editingMapping.sourceUserEmail" class="text-xs text-muted truncate">
                {{ editingMapping.sourceUserEmail }}
              </p>
            </div>
          </div>

          <UIcon name="i-lucide-arrow-right" class="w-4 h-4 text-muted flex-shrink-0" />

          <!-- Notion user picker -->
          <div class="flex-1">
            <CroutonTriageUsermappingsNotionUserPicker
              v-model="editingNotionUserId"
              :notion-token="notionToken"
              :notion-account-id="notionAccountId"
              :team-id="teamId"
              placeholder="Select Notion user..."
            />
          </div>

          <!-- Save button -->
          <UButton
            color="primary"
            size="sm"
            icon="i-lucide-check"
            :loading="saving"
            :disabled="!editingNotionUserId"
            @click="saveEditedMapping"
          >
            Save
          </UButton>
        </div>
      </div>

      <!-- Existing Mappings -->
      <div v-if="existingMappings.length > 0" class="space-y-3">
        <h5 class="font-medium">Existing Mappings ({{ existingMappings.length }})</h5>
        <CroutonTriageUsermappingsUserMappingTable
          :mappings="existingMappings"
          :loading="loadingMappings"
          compact
          @edit="editMappingStart"
          @delete="deleteMapping"
        />
      </div>

      <!-- Empty state -->
      <div
        v-if="slackUsers.length === 0 && !loading && !slackError"
        class="text-center py-8 text-muted"
      >
        <UIcon name="i-lucide-slack" class="w-12 h-12 mx-auto mb-3 opacity-30" />
        <p>No Slack users found</p>
        <p class="text-sm mt-1">Check your Slack token and workspace connection</p>
      </div>
    </template>
  </div>
</template>
