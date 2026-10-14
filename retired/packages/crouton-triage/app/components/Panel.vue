<script setup lang="ts">
// @ts-expect-error - layer types resolved at app level
import type { Flow, FlowInput, FlowOutput } from '#layers/triage/types'

interface Props {
  /** Title shown in the panel header */
  title?: string
  /** Empty state message */
  emptyMessage?: string
  /** Max feed items to show */
  limit?: number
  /** Page record when used as page type */
  page?: any
}

const props = withDefaults(defineProps<Props>(), {
  title: 'Triage',
  emptyMessage: 'No activity yet. Connect a source to get started.',
  limit: 30,
  page: undefined,
})

const { currentTeam } = useTeam()
const notify = useNotify()
const creatingFlow = ref(false)
const pendingFlowId = ref<string | null>(null)
const addExpanded = ref(false)
const addSourceDropOpen = ref(false)
const addOutputDropOpen = ref(false)
const showAiConfig = ref(false)
const addSourceType = ref<'slack' | 'figma' | 'email' | null>(null)
const addOutputType = ref<'notion' | 'github' | 'linear' | null>(null)

let addCollapseTimer: ReturnType<typeof setTimeout> | null = null

function cancelAddCollapse() {
  if (addCollapseTimer) { clearTimeout(addCollapseTimer); addCollapseTimer = null }
}

const addBusy = computed(() =>
  creatingFlow.value || addSourceDropOpen.value || addOutputDropOpen.value
  || showAiConfig.value || !!addSourceType.value || !!addOutputType.value
)

function scheduleAddCollapse() {
  cancelAddCollapse()
  addCollapseTimer = setTimeout(() => {
    if (!addBusy.value) {
      addExpanded.value = false
    }
    addCollapseTimer = null
  }, 300)
}

function onAddMouseEnter() { cancelAddCollapse(); addExpanded.value = true }
function onAddMouseLeave() { scheduleAddCollapse() }

// Keep expanded while busy; schedule collapse when everything closes.
watch(addBusy, (busy) => {
  if (busy) {
    cancelAddCollapse()
  } else {
    scheduleAddCollapse()
  }
})

// Shared flow creation — returns the created flow or null on error
async function createFlow(): Promise<Flow | null> {
  if (!currentTeam.value?.id || creatingFlow.value) return null
  creatingFlow.value = true
  try {
    const flow = await $fetch<Flow>(`/api/teams/${currentTeam.value.id}/triage-flows`, {
      method: 'POST',
      body: {
        name: 'Untitled Flow',
        active: false,
        onboardingComplete: false,
        aiEnabled: true,
      },
    })
    await refreshFlows()
    return flow
  } catch (error: any) {
    notify.error('Failed to create flow', { description: error.data?.message || error.message || 'Something went wrong.' })
    return null
  } finally {
    creatingFlow.value = false
  }
}

// All three paths use pendingFlowId — dismissed without saving = flow deleted

async function handleCreateFlowWithAi() {
  const flow = await createFlow()
  if (!flow) return
  pendingFlowId.value = flow.id
  activeFlow.value = flow
  showAiConfig.value = true
}

async function handleCreateFlowWithSource(type: 'slack' | 'figma' | 'email') {
  const flow = await createFlow()
  if (!flow) return
  pendingFlowId.value = flow.id
  activeFlow.value = flow
  addSourceType.value = type
}

async function handleCreateFlowWithOutput(type: 'notion' | 'github' | 'linear') {
  const flow = await createFlow()
  if (!flow) return
  pendingFlowId.value = flow.id
  activeFlow.value = flow
  addOutputType.value = type
}

// Delete a pending flow that was dismissed without saving
async function deletePendingFlow() {
  const flowId = pendingFlowId.value
  if (!flowId || !currentTeam.value?.id) return
  pendingFlowId.value = null
  try {
    await $fetch(`/api/teams/${currentTeam.value.id}/triage-flows/${flowId}`, {
      method: 'DELETE',
    })
    await refreshFlows()
  } catch {
    // Silent fail — flow was temporary anyway
  }
}

// Dropdown items for add-flow source/output type pickers
const addFlowSourceItems = [[
  { label: 'Slack', icon: 'i-lucide-slack', onSelect: () => handleCreateFlowWithSource('slack') },
  { label: 'Figma', icon: 'i-lucide-figma', onSelect: () => handleCreateFlowWithSource('figma') },
  { label: 'Email', icon: 'i-lucide-mail', onSelect: () => handleCreateFlowWithSource('email') },
]]

const addFlowOutputItems = [[
  { label: 'Notion', icon: 'i-simple-icons-notion', onSelect: () => handleCreateFlowWithOutput('notion') },
  { label: 'GitHub', icon: 'i-lucide-github', disabled: true, onSelect: () => handleCreateFlowWithOutput('github') },
  { label: 'Linear', icon: 'i-simple-icons-linear', disabled: true, onSelect: () => handleCreateFlowWithOutput('linear') },
]]

// Data fetching (all at once to preserve Nuxt async context)
const [
  { items: flows, pending: flowsPending, refresh: refreshFlows },
  { items: inputs, pending: inputsPending, refresh: refreshInputs },
  { items: outputs, pending: outputsPending, refresh: refreshOutputs },
  { items: userMappings, refresh: refreshMappings },
  { items: connectedAccounts, refresh: refreshAccounts },
] = await Promise.all([
  useCollectionQuery('triageFlows'),
  useCollectionQuery('triageInputs'),
  useCollectionQuery('triageOutputs'),
  useCollectionQuery('triageUsers'),
  useCollectionQuery('triageAccounts'),
])

// All flows (newest first — query already orders by desc createdAt)
const allFlows = computed<Flow[]>(() => (flows.value || []) as Flow[])
const hasFlows = computed(() => allFlows.value.length > 0)

// Helpers to get inputs/outputs per flow
function getFlowInputs(flowId: string): FlowInput[] {
  return ((inputs.value || []) as FlowInput[]).filter(i => i.flowId === flowId)
}

function getFlowOutputs(flowId: string): FlowOutput[] {
  return ((outputs.value || []) as FlowOutput[]).filter(o => o.flowId === flowId)
}

// User mapping stats (team-global, not per-flow)
// Only source types that support user mapping discovery
const mappableSourceTypes = new Set(['slack', 'figma', 'notion'])

const uniqueSources = computed(() => {
  const seen = new Map<string, FlowInput>()
  for (const input of (inputs.value || []) as FlowInput[]) {
    if (!mappableSourceTypes.has(input.sourceType)) continue
    const wsId = getWorkspaceId(input)
    const key = `${input.sourceType}:${wsId}`
    if (!seen.has(key)) seen.set(key, input)
  }
  return [...seen.values()]
})

const activeMappingCount = computed(() =>
  ((userMappings.value || []) as any[]).filter(m => m.active).length
)

function getWorkspaceId(input: FlowInput): string {
  return input.sourceMetadata?.slackTeamId
    || input.emailSlug
    || input.sourceMetadata?.workspaceId
    || input.id
}

function getNotionTokenFromOutputs(): string | null {
  const allOutputs = (outputs.value || []) as FlowOutput[]
  const notionOutput = allOutputs.find(o =>
    o.outputType === 'notion' && (o.outputConfig as any)?.notionToken
  )
  return (notionOutput?.outputConfig as any)?.notionToken || null
}

function getNotionAccountIdFromOutputs(): string | null {
  const allOutputs = (outputs.value || []) as FlowOutput[]
  const notionOutput = allOutputs.find(o =>
    o.outputType === 'notion' && o.accountId
  )
  return notionOutput?.accountId || null
}

// Account manager
const showAccountManager = ref(false)

// User mapping drawer
const showUserMappingDrawer = ref(false)
const activeMapInput = ref<FlowInput | null>(null)

function openUserMappings(input: FlowInput) {
  activeMapInput.value = input
  showUserMappingDrawer.value = true
}

function getSourceIcon(sourceType: string): string {
  const icons: Record<string, string> = {
    slack: 'i-lucide-slack',
    figma: 'i-lucide-figma',
    notion: 'i-simple-icons-notion',
    email: 'i-lucide-mail',
  }
  return icons[sourceType] || 'i-lucide-inbox'
}

const sourceMenuItems = computed(() => [
  uniqueSources.value.map(input => ({
    label: input.sourceType.charAt(0).toUpperCase() + input.sourceType.slice(1),
    icon: getSourceIcon(input.sourceType),
    onSelect: () => openUserMappings(input),
  }))
])

// Feed data
const { feedItems, loading: feedLoading, refresh: refreshFeed } = await useTriageFeed({ limit: props.limit })

const loading = computed(() => flowsPending.value || inputsPending.value || outputsPending.value || feedLoading.value)

// Active flow for config slideovers/modals (set when user interacts with a specific flow)
const activeFlow = ref<Flow | null>(null)

// Track which specific input/output to edit (opens edit modal directly)
const editSourceInput = ref<FlowInput | null>(null)
const editOutputItem = ref<FlowOutput | null>(null)

// Pipeline builder event handlers (scoped to a flow)
function handleEditSource(flow: Flow, input: FlowInput) {
  activeFlow.value = flow
  editSourceInput.value = input
}

function handleEditAi(flow: Flow) {
  activeFlow.value = flow
  showAiConfig.value = true
}

function handleEditOutput(flow: Flow, output: FlowOutput) {
  activeFlow.value = flow
  editOutputItem.value = output
}

function handleAddSource(flow: Flow, type: 'slack' | 'figma' | 'email') {
  activeFlow.value = flow
  addSourceType.value = type
}

function handleAddOutput(flow: Flow, type: 'notion' | 'github' | 'linear') {
  activeFlow.value = flow
  addOutputType.value = type
}

// Refresh all data
async function refreshAll() {
  await Promise.all([refreshFlows(), refreshInputs(), refreshOutputs(), refreshFeed(), refreshMappings(), refreshAccounts()])
}

// Listen for mutations to auto-refresh
const nuxtApp = useNuxtApp()
nuxtApp.hook('crouton:mutation', async (event: { operation: string; collection: string }) => {
  const triageCollections = ['triageFlows', 'triageInputs', 'triageOutputs', 'triageDiscussions', 'triageJobs', 'triageTasks', 'triageUsers', 'triageAccounts']
  if (triageCollections.includes(event.collection)) {
    await refreshAll()
  }
})

// Retry handler for feed items
async function handleRetry(discussionId: string) {
  try {
    await $fetch(`/api/crouton-triage/teams/${currentTeam.value?.id}/discussions/${discussionId}/retry`, {
      method: 'POST',
      body: {},
    })
    notify.success('Retry started', { description: 'The discussion is being reprocessed.' })
    await refreshFeed()
  } catch (error: any) {
    notify.error('Retry failed', { description: error.data?.message || error.message || 'Failed to retry.' })
  }
}

// Toggle flow active state
const togglingFlow = ref<string | null>(null)

async function toggleFlowActive(flow: Flow) {
  if (!currentTeam.value?.id) return
  togglingFlow.value = flow.id
  try {
    await $fetch(`/api/teams/${currentTeam.value.id}/triage-flows/${flow.id}`, {
      method: 'PATCH',
      body: { active: !flow.active },
    })
    await refreshFlows()
  } catch (error: any) {
    notify.error('Failed to update flow', { description: error.data?.message || error.message || 'Something went wrong.' })
  } finally {
    togglingFlow.value = null
  }
}

// Delete flow — two-step inline confirm
const confirmingDeleteId = ref<string | null>(null)
const deleting = ref(false)

function confirmDeleteFlow(flow: Flow) {
  if (confirmingDeleteId.value === flow.id) {
    // Second click — actually delete
    handleDeleteFlow(flow)
  } else {
    // First click — show "Delete?" state
    confirmingDeleteId.value = flow.id
  }
}

async function handleDeleteFlow(flow: Flow) {
  if (!currentTeam.value?.id) return
  deleting.value = true
  try {
    await $fetch(`/api/teams/${currentTeam.value.id}/triage-flows/${flow.id}`, {
      method: 'DELETE',
    })
    confirmingDeleteId.value = null
    await refreshAll()
  } catch (error: any) {
    notify.error('Failed to delete flow', { description: error.data?.message || error.message || 'Something went wrong.' })
  } finally {
    deleting.value = false
  }
}

// Reset confirm state when clicking elsewhere
function resetDeleteConfirm() {
  confirmingDeleteId.value = null
}

onMounted(() => {
  document.addEventListener('click', resetDeleteConfirm)
})

onUnmounted(() => {
  document.removeEventListener('click', resetDeleteConfirm)
})

// Handle config changes — saving commits the pending flow
function onInputsChange() {
  pendingFlowId.value = null
  refreshInputs()
}

function onOutputsChange() {
  pendingFlowId.value = null
  refreshOutputs()
}

function onAiSaved() {
  pendingFlowId.value = null
  refreshFlows()
}

// When add-source/output modal closes, delete pending flow if nothing was saved
function onAutoAddSourceClosed() {
  addSourceType.value = null
  if (pendingFlowId.value) deletePendingFlow()
}

function onAutoAddOutputClosed() {
  addOutputType.value = null
  if (pendingFlowId.value) deletePendingFlow()
}

// If AI config is dismissed (closed without saving) and flow is still pending, delete it
watch(showAiConfig, (open) => {
  if (!open && pendingFlowId.value) {
    deletePendingFlow()
  }
})

defineExpose({ refresh: refreshAll })
</script>

<template>
  <div class="flex flex-col h-full">
    <!-- Flow list -->
    <div v-if="hasFlows || creatingFlow" class="flex flex-col gap-2">
      <!-- New flow button — side nodes slide out from center on hover, each clickable -->
      <div
        class="flex items-center justify-center py-1"
        @mouseenter="onAddMouseEnter"
        @mouseleave="onAddMouseLeave"
      >
        <div class="flex items-center transition-all duration-300 ease-out" :class="addExpanded ? 'gap-3' : 'gap-0'">
          <!-- Left node: source picker -->
          <UDropdownMenu v-model:open="addSourceDropOpen" :items="addFlowSourceItems">
            <button
              class="group/src h-10 rounded-xl bg-gray-500/10 flex items-center justify-center flex-shrink-0 transition-all duration-300 ease-out cursor-pointer hover:!opacity-100 hover:!scale-105"
              :class="addExpanded ? 'w-10 opacity-50 hover:w-auto hover:px-3 hover:gap-1.5' : 'w-0 opacity-0 overflow-hidden'"
            >
              <UIcon name="i-lucide-plus" class="w-5 h-5 text-gray-400 group-hover/src:hidden" />
              <span class="hidden group-hover/src:inline text-xs font-medium text-gray-500 whitespace-nowrap">add input</span>
            </button>
          </UDropdownMenu>
          <!-- Left arrow -->
          <div
            class="overflow-hidden transition-all duration-300 ease-out flex-shrink-0"
            :class="addExpanded ? 'w-4 opacity-100' : 'w-0 opacity-0'"
          >
            <UIcon name="i-lucide-arrow-right" class="w-4 h-4 text-gray-400 dark:text-gray-600" />
          </div>
          <!-- Center node: AI config -->
          <button
            class="group/ai w-10 h-10 rounded-xl bg-gray-500/10 opacity-50 flex items-center justify-center flex-shrink-0 transition-all duration-300 cursor-pointer hover:!opacity-100 hover:!scale-105 hover:w-auto hover:px-3 hover:gap-1.5"
            @click="handleCreateFlowWithAi"
          >
            <template v-if="creatingFlow">
              <UIcon name="i-lucide-loader-2" class="w-5 h-5 text-gray-400 animate-spin" />
            </template>
            <template v-else>
              <UIcon name="i-lucide-plus" class="w-5 h-5 text-gray-400 group-hover/ai:hidden" />
              <span class="hidden group-hover/ai:inline text-xs font-medium text-gray-500 whitespace-nowrap">add flow</span>
            </template>
          </button>
          <!-- Right arrow -->
          <div
            class="overflow-hidden transition-all duration-300 ease-out flex-shrink-0"
            :class="addExpanded ? 'w-4 opacity-100' : 'w-0 opacity-0'"
          >
            <UIcon name="i-lucide-arrow-right" class="w-4 h-4 text-gray-400 dark:text-gray-600" />
          </div>
          <!-- Right node: output picker -->
          <UDropdownMenu v-model:open="addOutputDropOpen" :items="addFlowOutputItems">
            <button
              class="group/out h-10 rounded-xl bg-gray-500/10 flex items-center justify-center flex-shrink-0 transition-all duration-300 ease-out cursor-pointer hover:!opacity-100 hover:!scale-105"
              :class="addExpanded ? 'w-10 opacity-50 hover:w-auto hover:px-3 hover:gap-1.5' : 'w-0 opacity-0 overflow-hidden'"
            >
              <UIcon name="i-lucide-plus" class="w-5 h-5 text-gray-400 group-hover/out:hidden" />
              <span class="hidden group-hover/out:inline text-xs font-medium text-gray-500 whitespace-nowrap">add output</span>
            </button>
          </UDropdownMenu>
        </div>
      </div>

      <div
        v-for="flow in allFlows"
        :key="flow.id"
        class="group flex items-center justify-center gap-1"
      >
        <!-- Activate/Pause (left, next to inputs) -->
        <button
          class="group/act h-7 rounded-full flex items-center justify-center flex-shrink-0 transition-all cursor-pointer"
          :class="flow.active
            ? 'w-7 hover:w-auto hover:px-2.5 group-hover:bg-green-500/20 group-hover:text-green-500'
            : 'w-7 hover:w-auto hover:px-2.5 group-hover:bg-gray-500/10 group-hover:text-gray-400'"
          :disabled="togglingFlow === flow.id"
          @click="toggleFlowActive(flow)"
        >
          <!-- Dot (default, no row hover) -->
          <div
            class="w-2 h-2 rounded-full transition-opacity group-hover:hidden"
            :class="flow.active ? 'bg-green-500' : 'bg-gray-400 dark:bg-gray-600'"
          />
          <!-- Row hover: icon, replaced by text on button hover -->
          <UIcon v-if="togglingFlow === flow.id" name="i-lucide-loader-2" class="w-3.5 h-3.5 animate-spin hidden group-hover:block group-hover/act:!hidden" />
          <UIcon v-else-if="flow.active" name="i-lucide-zap" class="w-3.5 h-3.5 hidden group-hover:block group-hover/act:!hidden" />
          <UIcon v-else name="i-lucide-pause" class="w-3.5 h-3.5 hidden group-hover:block group-hover/act:!hidden" />
          <span class="hidden group-hover/act:!inline text-xs font-medium whitespace-nowrap">
            {{ togglingFlow === flow.id ? '...' : flow.active ? 'pause' : 'activate' }}
          </span>
        </button>

        <!-- Pipeline (full width, AI centered) -->
        <CroutonTriagePipelineBuilder
          class=""
          :flow="flow"
          :inputs="getFlowInputs(flow.id)"
          :outputs="getFlowOutputs(flow.id)"
          @edit:source="(input: FlowInput) => handleEditSource(flow, input)"
          @edit:ai="() => handleEditAi(flow)"
          @edit:output="(output: FlowOutput) => handleEditOutput(flow, output)"
          @add:source="(type: 'slack' | 'figma' | 'email') => handleAddSource(flow, type)"
          @add:output="(type: 'notion' | 'github' | 'linear') => handleAddOutput(flow, type)"
        />

        <!-- Delete (right, next to outputs) -->
        <button
          class="group/del relative h-7 rounded-full flex items-center justify-center flex-shrink-0 transition-all cursor-pointer opacity-0 group-hover:opacity-50 pointer-events-none group-hover:pointer-events-auto"
          :class="[
            confirmingDeleteId === flow.id
              ? '!opacity-100 bg-red-500/20 text-red-500 px-2.5'
              : 'w-7 hover:!w-auto hover:!px-2.5 bg-gray-500/10 text-gray-400 hover:!bg-red-500/20 hover:!text-red-500 hover:!opacity-100'
          ]"
          @click.stop="confirmDeleteFlow(flow)"
        >
          <UIcon v-if="deleting && confirmingDeleteId === flow.id" name="i-lucide-loader-2" class="w-3.5 h-3.5 animate-spin" />
          <template v-else-if="confirmingDeleteId === flow.id">
            <span class="text-xs font-medium whitespace-nowrap">sure</span>
          </template>
          <template v-else>
            <UIcon name="i-lucide-trash-2" class="w-3.5 h-3.5 group-hover/del:hidden" />
            <span class="hidden group-hover/del:inline text-xs font-medium whitespace-nowrap">delete</span>
          </template>
        </button>
      </div>

    </div>

    <!-- Empty state -->
    <div
      v-if="!hasFlows && !flowsPending && !creatingFlow"
      class="text-center py-8"
    >
      <div class="w-12 h-12 rounded-full bg-muted/50 flex items-center justify-center mx-auto mb-3">
        <UIcon name="i-lucide-funnel" class="w-6 h-6 text-muted-foreground" />
      </div>
      <p class="text-sm text-muted-foreground mb-3">No flows yet</p>
      <UButton
        color="primary"
        variant="ghost"
        size="sm"
        icon="i-lucide-plus"
        :loading="creatingFlow"
        @click="handleCreateFlowWithAi"
      >
        New Flow
      </UButton>
    </div>

    <!-- User Mappings Summary -->
    <div v-if="hasFlows && uniqueSources.length > 0" class="flex items-center gap-2 px-1 py-2">
      <UIcon name="i-lucide-users" class="w-4 h-4 text-muted shrink-0" />
      <span class="text-sm text-muted">
        {{ activeMappingCount }} user{{ activeMappingCount !== 1 ? 's' : '' }} mapped
        across {{ uniqueSources.length }} source{{ uniqueSources.length !== 1 ? 's' : '' }}
      </span>

      <!-- Single source: direct button -->
      <UButton
        v-if="uniqueSources.length === 1"
        size="xs"
        variant="link"
        color="primary"
        @click="openUserMappings(uniqueSources[0])"
      >
        Manage
      </UButton>

      <!-- Multiple sources: dropdown -->
      <UDropdownMenu v-else :items="sourceMenuItems">
        <UButton size="xs" variant="link" color="primary">
          Manage
        </UButton>
      </UDropdownMenu>
    </div>

    <!-- Connected Accounts Summary -->
    <div v-if="hasFlows && connectedAccounts && (connectedAccounts as any[]).length > 0" class="flex items-center gap-2 px-1 py-2">
      <UIcon name="i-lucide-link" class="w-4 h-4 text-muted shrink-0" />
      <span class="text-sm text-muted">
        {{ (connectedAccounts as any[]).length }} account{{ (connectedAccounts as any[]).length !== 1 ? 's' : '' }} connected
      </span>
      <UButton
        size="xs"
        variant="link"
        color="primary"
        @click="showAccountManager = true"
      >
        Manage
      </UButton>
    </div>

    <!-- Account Manager Slideover -->
    <USlideover v-model:open="showAccountManager">
      <template #content="{ close }">
        <div class="p-6">
          <div class="flex items-center justify-between mb-6">
            <h2 class="text-lg font-semibold">Connected Accounts</h2>
            <UButton icon="i-lucide-x" color="neutral" variant="ghost" @click="close" />
          </div>
          <CroutonTriageFlowsAccountManager :team-id="currentTeam?.id || ''" />
        </div>
      </template>
    </USlideover>

    <!-- User Mapping Drawer -->
    <CroutonTriageUsermappingsUserMappingDrawer
      v-if="activeMapInput"
      v-model:open="showUserMappingDrawer"
      :source-type="(activeMapInput.sourceType as 'slack' | 'figma' | 'notion')"
      :source-workspace-id="getWorkspaceId(activeMapInput)"
      :api-token="activeMapInput.apiToken"
      :source-account-id="activeMapInput.accountId"
      :notion-token="getNotionTokenFromOutputs() || undefined"
      :notion-account-id="getNotionAccountIdFromOutputs() || undefined"
      :team-id="currentTeam?.id || ''"
      :input-name="activeMapInput.sourceType.charAt(0).toUpperCase() + activeMapInput.sourceType.slice(1)"
      @saved="refreshMappings"
    />

    <!-- Activity Feed -->
    <template v-if="hasFlows">
      <USeparator label="Recent Activity" class="mt-6" />

      <div v-if="feedLoading && feedItems.length === 0" class="space-y-3 mt-2">
        <div v-for="i in 3" :key="i" class="animate-pulse p-2 space-y-2">
          <div class="flex items-center gap-3">
            <div class="w-5 h-5 bg-muted rounded" />
            <div class="h-4 bg-muted rounded w-1/3" />
            <div class="h-3 bg-muted rounded w-16 ml-auto" />
          </div>
          <div class="h-3 bg-muted rounded w-2/3 ml-8" />
        </div>
      </div>

      <div v-else-if="feedItems.length > 0" class="flex-1 min-h-0 overflow-y-auto mt-2">
        <CroutonTriageFeedItem
          v-for="item in feedItems"
          :key="item.id"
          :item="item"
          @retry="handleRetry"
        />
      </div>

      <div v-else class="text-center py-6">
        <p class="text-sm text-muted-foreground">{{ emptyMessage }}</p>
      </div>
    </template>

    <!-- AI Config Slideover (scoped to active flow) -->
    <CroutonTriageAiConfig
      v-if="activeFlow"
      v-model="showAiConfig"
      :flow="activeFlow"
      :team-id="currentTeam?.id || ''"
      @save="onAiSaved"
    />

    <!-- Direct modals for inputs (add + edit, scoped to active flow) -->
    <div v-if="activeFlow && (addSourceType || editSourceInput)" class="hidden">
      <CroutonTriageFlowsInputManager
        :flow-id="activeFlow.id"
        :team-id="currentTeam?.id || ''"
        :model-value="getFlowInputs(activeFlow.id)"
        :auto-add-type="addSourceType"
        :auto-edit-input="editSourceInput"
        edit-mode
        @change="onInputsChange"
        @auto-add-closed="onAutoAddSourceClosed"
        @auto-edit-closed="editSourceInput = null"
      />
    </div>

    <!-- Direct modals for outputs (add + edit, scoped to active flow) -->
    <div v-if="activeFlow && (addOutputType || editOutputItem)" class="hidden">
      <CroutonTriageFlowsOutputManager
        :flow-id="activeFlow.id"
        :team-id="currentTeam?.id || ''"
        :available-domains="activeFlow.availableDomains || []"
        :model-value="getFlowOutputs(activeFlow.id)"
        :auto-add-type="addOutputType"
        :auto-edit-output="editOutputItem"
        edit-mode
        @change="onOutputsChange"
        @auto-add-closed="onAutoAddOutputClosed"
        @auto-edit-closed="editOutputItem = null"
      />
    </div>

  </div>
</template>
