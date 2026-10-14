<script setup lang="ts">
import { z } from 'zod'
import type { FlowInput } from '../../types'

/**
 * InputManager Component
 *
 * Manages inputs for a flow. Supports:
 * - Slack inputs with OAuth
 * - Figma inputs with email configuration
 * - Generic email inputs
 *
 * Features:
 * - Add/edit/delete inputs
 * - OAuth integration for Slack
 * - Manual configuration for Figma/Email
 * - Display input status and webhook URLs
 */

interface Props {
  /**
   * Flow ID these inputs belong to
   */
  flowId: string

  /**
   * Team ID for OAuth and API calls
   */
  teamId: string

  /**
   * Initial list of inputs (for editing)
   */
  modelValue?: FlowInput[]

  /**
   * Whether the component is in edit mode (vs create mode in wizard)
   */
  editMode?: boolean

  /**
   * When set, auto-opens the add modal for this source type
   */
  autoAddType?: 'slack' | 'figma' | 'email' | null

  /**
   * When set, auto-opens the edit modal for this specific input
   */
  autoEditInput?: FlowInput | null
}

const props = withDefaults(defineProps<Props>(), {
  modelValue: () => [],
  editMode: false,
  autoEditInput: null,
})

const emit = defineEmits<{
  'update:modelValue': [value: FlowInput[]]
  'change': [value: FlowInput[]]
  'auto-add-closed': []
  'auto-edit-closed': []
}>()

// ============================================================================
// STATE
// ============================================================================

const inputs = ref<FlowInput[]>([...props.modelValue])
const isAddModalOpen = ref(false)
const isEditModalOpen = ref(false)
const isDeleteDialogOpen = ref(false)
const selectedInputType = ref<'slack' | 'figma' | 'email'>('slack')
const editingInput = ref<FlowInput | null>(null)
const deletingInput = ref<FlowInput | null>(null)

// Template refs to AccountPicker instances — used to refresh the account list
// after OAuth completes so newly-connected accounts appear immediately.
const addAccountPickerRef = ref<{ fetchAccounts: () => Promise<void> } | null>(null)
const editAccountPickerRef = ref<{ fetchAccounts: () => Promise<void> } | null>(null)

const notify = useNotify()

// ============================================================================
// INPUT FORM STATE
// ============================================================================

const slackWorkspace = ref('')

const inputFormState = ref({
  sourceType: 'slack',
  name: '',
  apiToken: '',
  accountId: undefined as string | undefined,
  emailAddress: '',
  sourceMetadata: {} as Record<string, any>,
  active: true,
})

// ============================================================================
// VALIDATION SCHEMAS
// ============================================================================

const slackInputSchema = z.object({
  accountId: z.string().optional(),
  apiToken: z.string().optional(),
  sourceMetadata: z.object({
    slackTeamId: z.string().optional(),
    slackWorkspaceName: z.string().optional(),
  }).optional(),
}).refine(
  data => !!data.accountId || !!data.apiToken,
  { message: 'Either select a connected account or authenticate with OAuth' },
)

const figmaInputSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  emailAddress: z.string().email('Invalid email address'),
  apiToken: z.string().min(1, 'Figma Personal Access Token is required'),
})

const emailInputSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  emailAddress: z.string().email('Invalid email address'),
})

const inputSchema = computed(() => {
  if (selectedInputType.value === 'slack') return slackInputSchema
  if (selectedInputType.value === 'figma') return figmaInputSchema
  return emailInputSchema
})

// ============================================================================
// OAUTH INTEGRATION
// ============================================================================

const { openOAuthPopup, waitingForOAuth } = useTriageOAuth({
  teamId: props.teamId,
  flowId: props.flowId, // Pass flowId so OAuth adds input to this specific flow
  slackTeam: slackWorkspace, // Pass workspace name to pre-select during OAuth
  provider: 'slack',
  onSuccess: async (credentials) => {
    // New account-based flow: OAuth callback creates/updates a triageAccount
    // and returns its ID. Select it in the form and refresh the picker so
    // the account appears in the dropdown.
    if (credentials.accountId) {
      inputFormState.value.accountId = credentials.accountId
      await Promise.all([
        addAccountPickerRef.value?.fetchAccounts(),
        editAccountPickerRef.value?.fetchAccounts(),
      ])
    }

    // Legacy inline-token flow (kept for backward compatibility)
    if (credentials.apiToken) {
      inputFormState.value.apiToken = credentials.apiToken
      inputFormState.value.sourceMetadata = {
        ...inputFormState.value.sourceMetadata,
        ...credentials.sourceMetadata,
      }
    }

    notify.success('Slack Connected', { description: 'OAuth credentials received successfully.' })

    // If in edit mode, the OAuth callback already created the input in the database
    // We need to refetch the inputs to show it in the UI
    if (props.editMode) {
      try {
        const response = await $fetch<FlowInput[]>(`/api/teams/${props.teamId}/triage-inputs`)
        // Filter inputs for this flow
        const flowInputs = response.filter(input => input.flowId === props.flowId)

        // Update local state
        inputs.value = flowInputs

        // Emit changes to parent
        emit('update:modelValue', inputs.value)
        emit('change', inputs.value)

      } catch (error: any) {
        console.error('[InputManager] Failed to refetch inputs:', error)
        notify.warning('Refresh Failed', { description: 'Failed to refresh inputs list. Please reload the page.' })
      }
    }
  },
  onError: (error) => {
    console.error('[InputManager] OAuth error:', error)
    notify.error('OAuth Failed', { description: error.message || 'Failed to connect Slack. Please try again.' })
  },
})

// ============================================================================
// INPUT MANAGEMENT
// ============================================================================

/**
 * Open add input modal
 */
function openAddModal(type: 'slack' | 'figma' | 'email') {
  selectedInputType.value = type
  resetForm()
  inputFormState.value.sourceType = type
  isAddModalOpen.value = true
}

/**
 * Open edit modal for existing input
 */
function openEditModal(input: FlowInput) {
  editingInput.value = input
  selectedInputType.value = input.sourceType as 'slack' | 'figma' | 'email'

  // Populate form with input data
  inputFormState.value = {
    sourceType: input.sourceType,
    name: input.name || '',
    apiToken: input.apiToken || '',
    accountId: input.accountId,
    emailAddress: input.emailAddress || '',
    sourceMetadata: input.sourceMetadata || {},
    active: input.active,
  }

  isEditModalOpen.value = true
}

/**
 * Open delete confirmation dialog
 */
function openDeleteDialog(input: FlowInput) {
  deletingInput.value = input
  isDeleteDialogOpen.value = true
}

/**
 * Reset form state
 */
function resetForm() {
  inputFormState.value = {
    sourceType: 'slack',
    name: '',
    apiToken: '',
    accountId: undefined,
    emailAddress: '',
    sourceMetadata: {},
    active: true,
  }
  slackWorkspace.value = ''
  editingInput.value = null
}

/**
 * Save new input
 */
async function saveNewInput() {
  try {
    // Validate form
    const validatedData = inputSchema.value.parse(inputFormState.value)

    // For Slack the name field isn't in the form — derive from workspace metadata.
    // For Figma/Email the user fills in the Name field directly.
    const inputName = inputFormState.value.name
      || inputFormState.value.sourceMetadata?.slackWorkspaceName
      || slackWorkspace.value
      || `${selectedInputType.value.charAt(0).toUpperCase() + selectedInputType.value.slice(1)} Input`

    // Create new input object
    const newInput: FlowInput = {
      id: `temp-${Date.now()}`, // Temporary ID, will be replaced by DB
      flowId: props.flowId,
      sourceType: selectedInputType.value,
      name: inputName,
      apiToken: inputFormState.value.apiToken || undefined,
      accountId: inputFormState.value.accountId,
      emailAddress: inputFormState.value.emailAddress || undefined,
      sourceMetadata: inputFormState.value.sourceMetadata,
      webhookUrl: generateWebhookUrl(selectedInputType.value),
      active: true,
    }

    // If in edit mode, save to API
    if (props.editMode) {
      const response = await $fetch(`/api/teams/${props.teamId}/triage-inputs`, {
        method: 'POST',
        body: newInput,
      })

      // Use server response
      inputs.value.push(response as FlowInput)

      notify.success('Input Added', { description: `${selectedInputType.value.charAt(0).toUpperCase() + selectedInputType.value.slice(1)} input has been added successfully.` })
    } else {
      // In wizard mode, just add to local array
      inputs.value.push(newInput)
    }

    // Emit changes
    emit('update:modelValue', inputs.value)
    emit('change', inputs.value)

    // Close modal and reset form
    isAddModalOpen.value = false
    resetForm()
  } catch (error: any) {
    console.error('[InputManager] Failed to save input:', error)

    // Show validation errors or API errors
    if (error.issues) {
      // Zod validation errors
      const errorMessages = error.issues.map((issue: any) => issue.message).join(', ')
      notify.error('Validation Error', { description: errorMessages })
    } else {
      notify.error('Save Failed', { description: error.message || 'Failed to save input. Please try again.' })
    }
  }
}

/**
 * Update existing input
 */
async function updateInput() {
  if (!editingInput.value) return

  try {
    // Validate form
    const validatedData = inputSchema.value.parse(inputFormState.value)

    // Update input object
    const updatedInput: FlowInput = {
      ...editingInput.value,
      name: inputFormState.value.name || editingInput.value.name,
      apiToken: inputFormState.value.apiToken || undefined,
      accountId: inputFormState.value.accountId,
      emailAddress: inputFormState.value.emailAddress || undefined,
      sourceMetadata: inputFormState.value.sourceMetadata,
      active: inputFormState.value.active,
    }

    // If in edit mode, update via API
    if (props.editMode) {
      const response = await $fetch(`/api/teams/${props.teamId}/triage-inputs/${editingInput.value.id}`, {
        method: 'PATCH',
        body: updatedInput,
      })

      // Find and replace in array
      const index = inputs.value.findIndex((i: FlowInput) => i.id === editingInput.value!.id)
      if (index !== -1) {
        inputs.value[index] = response as FlowInput
      }

      notify.success('Input Updated', { description: `${selectedInputType.value.charAt(0).toUpperCase() + selectedInputType.value.slice(1)} input has been updated successfully.` })
    } else {
      // In wizard mode, just update local array
      const index = inputs.value.findIndex((i: FlowInput) => i.id === editingInput.value!.id)
      if (index !== -1) {
        inputs.value[index] = updatedInput
      }
    }

    // Emit changes
    emit('update:modelValue', inputs.value)
    emit('change', inputs.value)

    // Close modal and reset form
    isEditModalOpen.value = false
    resetForm()
  } catch (error: any) {
    console.error('[InputManager] Failed to update input:', error)

    // Show validation errors or API errors
    if (error.issues) {
      const errorMessages = error.issues.map((issue: any) => issue.message).join(', ')
      notify.error('Validation Error', { description: errorMessages })
    } else {
      notify.error('Update Failed', { description: error.message || 'Failed to update input. Please try again.' })
    }
  }
}

/**
 * Delete input
 */
async function deleteInput() {
  if (!deletingInput.value) return

  try {
    // If in edit mode, delete via API
    if (props.editMode) {
      await $fetch(`/api/teams/${props.teamId}/triage-inputs/${deletingInput.value.id}`, {
        method: 'DELETE',
      })

      notify.success('Input Deleted', { description: `${deletingInput.value.sourceType.charAt(0).toUpperCase() + deletingInput.value.sourceType.slice(1)} input has been deleted successfully.` })
    }

    // Remove from local array
    inputs.value = inputs.value.filter((i: FlowInput) => i.id !== deletingInput.value!.id)

    // Emit changes
    emit('update:modelValue', inputs.value)
    emit('change', inputs.value)

    // Close dialog and reset
    isDeleteDialogOpen.value = false
    deletingInput.value = null
  } catch (error: any) {
    console.error('[InputManager] Failed to delete input:', error)
    notify.error('Delete Failed', { description: error.message || 'Failed to delete input. Please try again.' })
  }
}

/**
 * Generate webhook URL for input
 */
function generateWebhookUrl(sourceType: string): string {
  // Use the public runtime config to get the base URL
  const config = useRuntimeConfig()
  const baseUrl = config.public.baseUrl || 'https://triage.app'

  if (sourceType === 'slack') {
    return `${baseUrl}/api/crouton-triage/webhooks/slack`
  } else if (sourceType === 'figma') {
    return `${baseUrl}/api/crouton-triage/webhooks/resend`
  } else {
    return `${baseUrl}/api/crouton-triage/webhooks/resend`
  }
}

/**
 * Copy webhook URL to clipboard
 */
async function copyWebhookUrl(input: FlowInput) {
  if (!input.webhookUrl) return

  try {
    await navigator.clipboard.writeText(input.webhookUrl)
    notify.success('Copied!', { description: 'Webhook URL copied to clipboard.' })
  } catch (error) {
    console.error('[InputManager] Failed to copy webhook URL:', error)
    notify.error('Copy Failed', { description: 'Failed to copy webhook URL. Please copy manually.' })
  }
}

/**
 * Get input status badge
 */
function getInputStatus(input: FlowInput): { label: string; color: 'error' | 'info' | 'success' | 'warning' | 'primary' | 'secondary' | 'neutral' } {
  if (!input.active) {
    return { label: 'Inactive', color: 'neutral' }
  }

  if (input.sourceType === 'slack') {
    const hasConnection = (!!input.apiToken || !!input.accountId) && !!input.sourceMetadata?.slackTeamId
    return hasConnection
      ? { label: input.accountId ? 'Account Connected' : 'OAuth Connected', color: 'success' }
      : { label: 'Not Connected', color: 'warning' }
  }

  return { label: 'Active', color: 'info' }
}

/**
 * Get workspace name for Slack inputs
 */
function getWorkspaceName(input: FlowInput): string | null {
  if (input.sourceType === 'slack') {
    return input.sourceMetadata?.slackWorkspaceName || input.sourceMetadata?.slackTeamId || null
  }
  return null
}

// ============================================================================
// WATCHERS
// ============================================================================

// Watch for external changes to modelValue
watch(() => props.modelValue, (newValue) => {
  inputs.value = [...newValue]
}, { deep: true })

// Auto-open add modal when autoAddType is set
watch(() => props.autoAddType, (type) => {
  if (type) {
    openAddModal(type)
  }
}, { immediate: true })

// Auto-open edit modal when autoEditInput is set
watch(() => props.autoEditInput, (input) => {
  if (input) {
    openEditModal(input)
  }
}, { immediate: true })

// Notify parent when auto-opened modal closes
watch(isAddModalOpen, (open) => {
  if (!open && props.autoAddType) {
    emit('auto-add-closed')
  }
})

watch(isEditModalOpen, (open) => {
  if (!open && props.autoEditInput) {
    emit('auto-edit-closed')
  }
})
</script>

<template>
  <div class="space-y-4">
    <!-- Header -->
    <div class="flex items-center justify-between">
      <div>
        <h3 class="text-lg font-semibold">Input Sources</h3>
        <p class="text-sm text-gray-500">
          Connect sources like Slack, Figma, or email to this flow.
        </p>
      </div>

      <!-- Add Input Dropdown -->
      <UDropdownMenu
        :items="[
          [{
            label: 'Slack (OAuth)',
            icon: 'i-lucide-message-square',
            onSelect: () => openAddModal('slack')
          }],
          [{
            label: 'Figma (Email)',
            icon: 'i-lucide-mail',
            onSelect: () => openAddModal('figma')
          }],
          [{
            label: 'Generic Email',
            icon: 'i-lucide-mail',
            onSelect: () => openAddModal('email')
          }]
        ]"
      >
        <UButton
          label="Add Input"
          icon="i-lucide-plus"
          color="primary"
        />
      </UDropdownMenu>
    </div>

    <!-- Empty State -->
    <UAlert
      v-if="inputs.length === 0"
      title="No inputs yet"
      description="Add an input source to start receiving discussions from Slack, Figma, or email."
      color="info"
      variant="soft"
    />

    <!-- Input Cards -->
    <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
      <UCard
        v-for="input in inputs"
        :key="input.id"
        class="relative"
      >
        <template #header>
          <div class="flex items-start justify-between">
            <div class="flex-1">
              <div class="flex items-center gap-2">
                <h4 class="font-semibold">{{ input.sourceType.charAt(0).toUpperCase() + input.sourceType.slice(1) }}</h4>
                <UBadge
                  :label="getInputStatus(input).label"
                  :color="getInputStatus(input).color"
                  size="xs"
                />
              </div>
            </div>

            <!-- Actions -->
            <div class="flex items-center gap-1">
              <UButton
                icon="i-lucide-pencil"
                color="neutral"
                variant="ghost"
                size="sm"
                @click="openEditModal(input)"
              />
              <UButton
                icon="i-lucide-trash-2"
                color="neutral"
                variant="ghost"
                size="sm"
                @click="openDeleteDialog(input)"
              />
            </div>
          </div>
        </template>

        <div class="space-y-3">
          <!-- Slack-specific info -->
          <div v-if="input.sourceType === 'slack' && getWorkspaceName(input)">
            <p class="text-sm text-gray-500">Workspace</p>
            <p class="text-sm font-medium">{{ getWorkspaceName(input) }}</p>
          </div>

          <!-- Figma/Email-specific info -->
          <div v-if="input.sourceType !== 'slack' && input.emailSlug">
            <p class="text-sm text-gray-500">Email Slug</p>
            <p class="text-sm font-medium">{{ input.emailSlug }}</p>
          </div>

          <div v-if="input.emailAddress">
            <p class="text-sm text-gray-500">Email Address</p>
            <p class="text-sm font-medium">{{ input.emailAddress }}</p>
          </div>

          <!-- Webhook URL -->
          <div v-if="input.webhookUrl">
            <p class="text-sm text-gray-500 mb-1">Webhook URL</p>
            <div class="flex items-center gap-2">
              <UInput
                :model-value="input.webhookUrl"
                readonly
                size="sm"
                class="flex-1"
              />
              <UButton
                icon="i-lucide-clipboard-copy"
                color="neutral"
                variant="ghost"
                size="sm"
                @click="copyWebhookUrl(input)"
              />
            </div>
          </div>
        </div>
      </UCard>
    </div>

    <!-- Add Input Modal -->
    <UModal v-model:open="isAddModalOpen">
      <template #content="{ close }">
        <div class="p-6">
          <h3 class="text-lg font-semibold mb-4">
            Add {{ selectedInputType.charAt(0).toUpperCase() + selectedInputType.slice(1) }} Input
          </h3>

          <UForm
            :state="inputFormState"
            :schema="inputSchema"
            class="space-y-4"
            @submit="saveNewInput"
          >
            <!-- Slack-specific fields -->
            <template v-if="selectedInputType === 'slack'">
              <!-- Connected Account Picker -->
              <UFormField label="Connected Account" name="accountId">
                <CroutonTriageFlowsAccountPicker
                  ref="addAccountPickerRef"
                  v-model="inputFormState.accountId"
                  provider="slack"
                  :team-id="teamId"
                  placeholder="Select Slack account or connect new..."
                  @connect-new="openOAuthPopup"
                />
              </UFormField>

              <!-- Show OAuth only if no account selected -->
              <template v-if="!inputFormState.accountId">
                <UFormField label="Slack Workspace" name="slackWorkspace">
                  <UInput
                    v-model="slackWorkspace"
                    placeholder="e.g., myteam or myteam.slack.com"
                    class="w-full"
                  />
                  <template #help>
                    Optional. Enter your workspace name to ensure the correct workspace is selected during OAuth.
                  </template>
                </UFormField>

                <UFormField label="OAuth Connection" name="apiToken">
                  <div class="space-y-2">
                    <UButton
                      label="Connect with Slack"
                      icon="i-lucide-message-square"
                      color="primary"
                      :loading="waitingForOAuth"
                      @click="openOAuthPopup"
                    />

                    <UAlert
                      v-if="inputFormState.sourceMetadata.slackWorkspaceName"
                      :title="`Connected to ${inputFormState.sourceMetadata.slackWorkspaceName}`"
                      color="success"
                      variant="soft"
                    />

                    <UAlert
                      v-else
                      title="OAuth Required"
                      description="Click the button above to connect your Slack workspace, or select an existing account."
                      color="info"
                      variant="soft"
                    />
                  </div>
                </UFormField>
              </template>
            </template>

            <!-- Figma/Email-specific fields -->
            <template v-if="selectedInputType !== 'slack'">
              <UFormField label="Name" name="name" required>
                <UInput
                  v-model="inputFormState.name"
                  placeholder="e.g., Design Team Figma"
                  class="w-full"
                />
              </UFormField>

              <UFormField label="Email Address" name="emailAddress" required>
                <UInput
                  v-model="inputFormState.emailAddress"
                  type="email"
                  placeholder="e.g., figma-comments@messages.yourdomain.com"
                  help="The inbound address Figma notifications are forwarded to"
                  class="w-full"
                />
              </UFormField>

              <UFormField
                v-if="selectedInputType === 'figma'"
                label="Figma Personal Access Token"
                name="apiToken"
                required
                help="Create at figma.com/settings → Personal access tokens. Needs file_comments:read + file_comments:write scopes."
              >
                <UInput
                  v-model="inputFormState.apiToken"
                  type="password"
                  placeholder="figd_..."
                  class="w-full"
                />
              </UFormField>
            </template>

            <!-- Actions -->
            <div class="flex justify-end gap-2 mt-6">
              <UButton
                label="Cancel"
                color="neutral"
                variant="ghost"
                @click="close"
              />
              <UButton
                label="Add Input"
                type="submit"
                color="primary"
              />
            </div>
          </UForm>
        </div>
      </template>
    </UModal>

    <!-- Edit Input Modal -->
    <UModal v-model:open="isEditModalOpen">
      <template #content="{ close }">
        <div class="p-6">
          <h3 class="text-lg font-semibold mb-4">
            Edit {{ selectedInputType.charAt(0).toUpperCase() + selectedInputType.slice(1) }} Input
          </h3>

          <UForm
            :state="inputFormState"
            :schema="inputSchema"
            class="space-y-4"
            @submit="updateInput"
          >
            <!-- Slack-specific fields -->
            <template v-if="selectedInputType === 'slack'">
              <!-- Connected Account Picker -->
              <UFormField label="Connected Account" name="accountId">
                <CroutonTriageFlowsAccountPicker
                  ref="editAccountPickerRef"
                  v-model="inputFormState.accountId"
                  provider="slack"
                  :team-id="teamId"
                  placeholder="Select Slack account..."
                  @connect-new="openOAuthPopup"
                />
              </UFormField>

              <!-- Show OAuth/reconnect only if no account selected -->
              <template v-if="!inputFormState.accountId">
                <UFormField label="Slack Workspace" name="slackWorkspace">
                  <UInput
                    v-model="slackWorkspace"
                    placeholder="e.g., myteam or myteam.slack.com"
                    class="w-full"
                  />
                  <template #help>
                    Optional. Enter your workspace name to ensure the correct workspace is selected during OAuth.
                  </template>
                </UFormField>

                <UFormField label="OAuth Connection" name="apiToken">
                  <div class="space-y-2">
                    <UButton
                      label="Reconnect with Slack"
                      icon="i-lucide-message-square"
                      color="primary"
                      :loading="waitingForOAuth"
                      @click="openOAuthPopup"
                    />

                    <UAlert
                      v-if="inputFormState.sourceMetadata.slackWorkspaceName"
                      :title="`Connected to ${inputFormState.sourceMetadata.slackWorkspaceName}`"
                      color="success"
                      variant="soft"
                    />
                  </div>
                </UFormField>
              </template>
            </template>

            <!-- Figma/Email-specific fields -->
            <template v-if="selectedInputType !== 'slack'">
              <UFormField label="Name" name="name" required>
                <UInput
                  v-model="inputFormState.name"
                  placeholder="e.g., Design Team Figma"
                  class="w-full"
                />
              </UFormField>

              <UFormField label="Email Address" name="emailAddress" required>
                <UInput
                  v-model="inputFormState.emailAddress"
                  type="email"
                  placeholder="e.g., figma-comments@messages.yourdomain.com"
                  class="w-full"
                />
              </UFormField>

              <UFormField
                v-if="selectedInputType === 'figma'"
                label="Figma Personal Access Token"
                name="apiToken"
                required
                help="Create at figma.com/settings → Personal access tokens."
              >
                <UInput
                  v-model="inputFormState.apiToken"
                  type="password"
                  :placeholder="editingInput?.apiToken ? '•••••• (leave blank to keep existing)' : 'figd_...'"
                  class="w-full"
                />
              </UFormField>
            </template>

            <!-- Active Toggle -->
            <UFormField label="Status" name="active">
              <USwitch v-model="inputFormState.active" />
              <template #help>
                {{ inputFormState.active ? 'Input is active' : 'Input is inactive' }}
              </template>
            </UFormField>

            <!-- Actions -->
            <div class="flex justify-end gap-2 mt-6">
              <UButton
                label="Cancel"
                color="neutral"
                variant="ghost"
                @click="close"
              />
              <UButton
                label="Update Input"
                type="submit"
                color="primary"
              />
            </div>
          </UForm>
        </div>
      </template>
    </UModal>

    <!-- Delete Confirmation Dialog -->
    <UModal v-model:open="isDeleteDialogOpen">
      <template #content="{ close }">
        <div class="p-6">
          <h3 class="text-lg font-semibold mb-2">Delete Input</h3>
          <p class="text-gray-600 mb-6">
            Are you sure you want to delete this <strong>{{ deletingInput?.sourceType }}</strong> input?
            This action cannot be undone.
          </p>

          <div class="flex justify-end gap-2">
            <UButton
              label="Cancel"
              color="neutral"
              variant="ghost"
              @click="close"
            />
            <UButton
              label="Delete"
              color="error"
              @click="deleteInput"
            />
          </div>
        </div>
      </template>
    </UModal>
  </div>
</template>
