<script setup lang="ts">
/**
 * UserMappingDrawer - Container component that routes to correct discovery UI
 *
 * Entry point for user mapping management. Opens as a slideover and shows
 * the appropriate discovery UI based on source type (Slack or Figma).
 */

interface Props {
  /** Whether the drawer is open */
  open: boolean
  /** Source type (slack, figma, or notion) */
  sourceType: 'slack' | 'figma' | 'notion'
  /** Workspace ID for the source */
  sourceWorkspaceId: string
  /** Source API token for Slack (legacy — prefer sourceAccountId) */
  apiToken?: string
  /** Connected account ID for source (Slack) token resolution */
  sourceAccountId?: string
  /** Notion token for user fetching (legacy — prefer notionAccountId) */
  notionToken?: string
  /** Connected account ID for Notion token resolution */
  notionAccountId?: string
  /** Team ID for API context */
  teamId: string
  /** Display name for the input */
  inputName?: string
}

const props = defineProps<Props>()

const emit = defineEmits<{
  'update:open': [value: boolean]
  'saved': []
}>()

// Sync open state
const isOpen = computed({
  get: () => props.open,
  set: (value) => emit('update:open', value)
})

// Handle save from child components
function handleSaved() {
  emit('saved')
}

// Source type display
const sourceTypeLabel = computed(() => {
  switch (props.sourceType) {
    case 'slack': return 'Slack'
    case 'figma': return 'Figma'
    case 'notion': return 'Notion'
    default: return 'Source'
  }
})

const sourceTypeIcon = computed(() => {
  switch (props.sourceType) {
    case 'slack': return 'i-lucide-slack'
    case 'figma': return 'i-lucide-figma'
    case 'notion': return 'i-simple-icons-notion'
    default: return 'i-lucide-user'
  }
})
</script>

<template>
  <USlideover v-model:open="isOpen" class="max-w-2xl">
    <!-- Header -->
    <template #header>
      <div class="flex items-center gap-3">
        <UIcon :name="sourceTypeIcon" class="w-5 h-5" />
        <div>
          <h3 class="font-semibold">User Mappings</h3>
          <p class="text-sm text-muted">
            {{ inputName || sourceTypeLabel }} &middot; {{ sourceWorkspaceId }}
          </p>
        </div>
      </div>
    </template>

    <!-- Body - Route to appropriate discovery UI -->
    <template #content>
      <div class="p-6">


        <!-- Slack Discovery -->
        <CroutonTriageUsermappingsSlackUserDiscovery
          v-if="sourceType === 'slack'"
          :workspace-id="sourceWorkspaceId"
          :api-token="apiToken"
          :slack-account-id="sourceAccountId"
          :notion-token="notionToken"
          :notion-account-id="notionAccountId"
          :team-id="teamId"
          @saved="handleSaved"
        />

        <!-- Figma Discovery -->
        <CroutonTriageUsermappingsFigmaUserDiscovery
          v-else-if="sourceType === 'figma'"
          :workspace-id="sourceWorkspaceId"
          :notion-token="notionToken"
          :notion-account-id="notionAccountId"
          :team-id="teamId"
          @saved="handleSaved"
        />

        <!-- Notion Discovery -->
        <CroutonTriageUsermappingsNotionUserDiscovery
          v-else-if="sourceType === 'notion'"
          :workspace-id="sourceWorkspaceId"
          :notion-token="notionToken"
          :notion-account-id="notionAccountId"
          :team-id="teamId"
          @saved="handleSaved"
        />

        <!-- Unknown source type -->
        <UAlert
          v-else
          color="warning"
          variant="soft"
          icon="i-lucide-alert-triangle"
          title="Unknown source type"
          :description="`User mapping is not supported for source type: ${sourceType}`"
        />
      </div>
    </template>

    <!-- Footer -->
    <template #footer>
      <div class="flex justify-end gap-2">
        <UButton
          color="neutral"
          variant="ghost"
          @click="isOpen = false"
        >
          Close
        </UButton>
      </div>
    </template>
  </USlideover>
</template>
