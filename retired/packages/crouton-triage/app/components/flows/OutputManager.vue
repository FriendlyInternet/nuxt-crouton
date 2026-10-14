<script setup lang="ts">
import { z } from 'zod'
import type { FlowOutput, NotionOutputConfig } from '../../types'

/**
 * OutputManager Component
 *
 * Manages outputs for a flow. Supports:
 * - Notion outputs with schema fetching and field mapping
 * - GitHub outputs (future)
 * - Linear outputs (future)
 *
 * Features:
 * - Add/edit/delete outputs
 * - Domain-based routing configuration
 * - Default output designation
 * - Notion schema fetching and auto-field mapping
 * - Display output status and configuration
 */

interface Props {
  /**
   * Flow ID these outputs belong to
   */
  flowId: string

  /**
   * Team ID for API calls
   */
  teamId: string

  /**
   * Available domains from the flow (for domain filter selection)
   */
  availableDomains: string[]

  /**
   * Initial list of outputs (for editing)
   */
  modelValue?: FlowOutput[]

  /**
   * Whether the component is in edit mode (vs create mode in wizard)
   */
  editMode?: boolean

  /**
   * When set, auto-opens the add modal for this output type
   */
  autoAddType?: 'notion' | 'github' | 'linear' | null

  /**
   * When set, auto-opens the edit modal for this specific output
   */
  autoEditOutput?: FlowOutput | null
}

const props = withDefaults(defineProps<Props>(), {
  modelValue: () => [],
  editMode: false,
  autoEditOutput: null,
})

const emit = defineEmits<{
  'update:modelValue': [value: FlowOutput[]]
  'change': [value: FlowOutput[]]
  'auto-add-closed': []
  'auto-edit-closed': []
}>()

// ============================================================================
// STATE
// ============================================================================

const outputs = ref<FlowOutput[]>([...props.modelValue])
const isAddModalOpen = ref(false)
const isEditModalOpen = ref(false)
const isDeleteDialogOpen = ref(false)
const selectedOutputType = ref<'notion' | 'github' | 'linear'>('notion')
const editingOutput = ref<FlowOutput | null>(null)
const deletingOutput = ref<FlowOutput | null>(null)

const notify = useNotify()

const DEFAULT_DOMAINS = ['design', 'frontend', 'backend', 'product', 'infrastructure', 'docs']

/**
 * Use flow's configured domains, falling back to defaults if none configured
 */
const domainOptions = computed(() =>
  props.availableDomains.length > 0 ? props.availableDomains : DEFAULT_DOMAINS
)

function isAllDomainsSelected(filter: string[]): boolean {
  return filter.length >= domainOptions.value.length
    && domainOptions.value.every(d => filter.includes(d))
}

/**
 * Toggle a domain in the output's domain filter
 */
function toggleDomain(domain: string) {
  const idx = outputFormState.value.domainFilter.indexOf(domain)
  if (idx >= 0) {
    outputFormState.value.domainFilter.splice(idx, 1)
  } else {
    outputFormState.value.domainFilter.push(domain)
  }
}

// ============================================================================
// OUTPUT FORM STATE
// ============================================================================

const outputFormState = ref({
  outputType: 'notion',
  domainFilter: [] as string[],
  isDefault: false,
  active: true,
  // Account reference
  accountId: undefined as string | undefined,
  // Notion-specific
  notionToken: '',
  databaseId: '',
  fieldMapping: {} as Record<string, any>,
})

// Connect account modal
const showConnectAccountModal = ref(false)
const connectAccountForm = ref({ label: '', token: '' })
const connectingAccount = ref(false)
const accountPickerRef = ref<{ fetchAccounts: () => Promise<void> } | null>(null)

const { createManualAccount: createAccount } = useTriageConnectedAccounts(props.teamId)

/**
 * Open modal to connect a new Notion account
 */
function openConnectAccountModal() {
  connectAccountForm.value = { label: '', token: '' }
  showConnectAccountModal.value = true
}

/**
 * Create a new connected account and auto-select it
 */
async function handleConnectAccount() {
  if (!connectAccountForm.value.label || !connectAccountForm.value.token) {
    notify.warning('Missing Fields', { description: 'Please enter a label and API token.' })
    return
  }

  connectingAccount.value = true
  try {
    const result = await createAccount({
      provider: 'notion',
      label: connectAccountForm.value.label,
      token: connectAccountForm.value.token,
    })

    // Refresh AccountPicker's account list
    await accountPickerRef.value?.fetchAccounts()

    if (result?.account?.id) {
      outputFormState.value.accountId = result.account.id
    }

    notify.success('Account Connected', { description: `${connectAccountForm.value.label} has been added.` })

    showConnectAccountModal.value = false
  } catch (err: any) {
    notify.error('Connection Failed', { description: err.message || 'Failed to connect account.' })
  } finally {
    connectingAccount.value = false
  }
}

// ============================================================================
// NOTION SCHEMA FETCHING
// ============================================================================

const {
  schema: notionSchema,
  loading: schemaLoading,
  error: schemaError,
  fetchNotionSchema: fetchSchema
} = useTriageNotionSchema()

// autoMapFields, generateValueMapping, getPropertyTypeColor — auto-imported from composables/useTriageFieldMapping.ts

/**
 * Update field mapping with full structure when a property is selected
 *
 * This builds the correct format expected by the backend:
 * { notionProperty: string, propertyType: string, valueMap: Record<string, string> }
 */
function updateFieldMapping(aiField: string, propertyName: string | null) {
  if (!propertyName || propertyName === '(none)') {
    // Clear the mapping if property is deselected
    delete outputFormState.value.fieldMapping[aiField]
    return
  }

  const propInfo = notionSchema.value?.properties?.[propertyName]
  if (!propInfo) return

  outputFormState.value.fieldMapping[aiField] = {
    notionProperty: propertyName,
    propertyType: propInfo.type,
    valueMap: (propInfo.type === 'select' || propInfo.type === 'status')
      ? generateValueMapping(aiField, propInfo.options)
      : {}
  }
}

/**
 * Notion property names with a "(none)" option prepended for clearing
 */
const notionPropertyOptions = computed(() => {
  const props = Object.keys(notionSchema.value?.properties || {})
  return ['(none)', ...props]
})

/**
 * Whether we have existing field mappings (even without schema loaded)
 */
const hasExistingMappings = computed(() => {
  return Object.keys(outputFormState.value.fieldMapping).length > 0
})

/**
 * Get the currently mapped Notion property name for an AI field
 */
function getMappedProperty(aiField: string): string | undefined {
  const mapping = outputFormState.value.fieldMapping[aiField]
  if (!mapping) return undefined
  return typeof mapping === 'string' ? mapping : mapping.notionProperty || undefined
}

/**
 * Fetch Notion schema and auto-map fields
 */
async function fetchNotionSchemaAndMap() {
  const hasToken = outputFormState.value.notionToken || outputFormState.value.accountId
  if (!hasToken || !outputFormState.value.databaseId) {
    notify.warning('Missing Information', { description: 'Please connect a Notion account (or enter token) and database ID first.' })
    return
  }

  try {
    await fetchSchema({
      notionToken: outputFormState.value.notionToken || undefined,
      accountId: outputFormState.value.accountId,
      databaseId: outputFormState.value.databaseId,
      teamId: props.teamId,
    })

    if (notionSchema.value) {
      // Auto-map fields
      const mappedFields = autoMapFields(notionSchema.value)
      outputFormState.value.fieldMapping = mappedFields

      notify.success('Schema Fetched', { description: 'Fields have been auto-mapped. Review and adjust as needed.' })
    }
  } catch (error: any) {
    console.error('[OutputManager] Failed to fetch schema:', error)
    notify.error('Schema Fetch Failed', { description: error.message || 'Failed to fetch Notion schema.' })
  }
}

// ============================================================================
// VALIDATION SCHEMAS
// ============================================================================

const notionOutputSchema = z.object({
  accountId: z.string().optional(),
  notionToken: z.string().optional(),
  databaseId: z.string().min(1, 'Database ID is required'),
}).refine(data => data.accountId || (data.notionToken && data.notionToken.length > 0), {
  message: 'Either select a connected account or provide a Notion token',
  path: ['notionToken'],
})

const githubOutputSchema = z.object({})

const linearOutputSchema = z.object({})

const outputSchema = computed(() => {
  switch (selectedOutputType.value) {
    case 'notion':
      return notionOutputSchema
    case 'github':
      return githubOutputSchema
    case 'linear':
      return linearOutputSchema
    default:
      return notionOutputSchema
  }
})

// ============================================================================
// OUTPUT TYPE OPTIONS
// ============================================================================

const outputTypeOptions = [
  {
    label: 'Notion',
    icon: 'i-lucide-file-text',
    onSelect: () => openAddModal('notion'),
  },
  {
    label: 'GitHub',
    icon: 'i-lucide-github',
    onSelect: () => openAddModal('github'),
    disabled: true, // Future feature
  },
  {
    label: 'Linear',
    icon: 'i-simple-icons-linear',
    onSelect: () => openAddModal('linear'),
    disabled: true, // Future feature
  },
]

// ============================================================================
// MODAL MANAGEMENT
// ============================================================================

/**
 * Open add modal for specific output type
 */
function openAddModal(type: 'notion' | 'github' | 'linear') {
  selectedOutputType.value = type
  resetForm()

  // If no outputs exist, make this the default
  if (outputs.value.length === 0) {
    outputFormState.value.isDefault = true
  }

  isAddModalOpen.value = true
}

/**
 * Open edit modal for existing output
 */
function openEditModal(output: FlowOutput) {
  editingOutput.value = output
  selectedOutputType.value = output.outputType as 'notion' | 'github' | 'linear'

  // Populate form with existing data
  outputFormState.value = {
    outputType: output.outputType,
    domainFilter: output.domainFilter?.length ? output.domainFilter : [...domainOptions.value],
    isDefault: output.isDefault,
    active: output.active,
    accountId: output.accountId,
    notionToken: (output.outputConfig as NotionOutputConfig)?.notionToken || '',
    databaseId: (output.outputConfig as NotionOutputConfig)?.databaseId || '',
    fieldMapping: (output.outputConfig as NotionOutputConfig)?.fieldMapping || {},
  }

  isEditModalOpen.value = true
}

/**
 * Open delete confirmation dialog
 */
function openDeleteDialog(output: FlowOutput) {
  deletingOutput.value = output
  isDeleteDialogOpen.value = true
}

/**
 * Reset form to defaults
 */
function resetForm() {
  outputFormState.value = {
    outputType: selectedOutputType.value,
    domainFilter: [...domainOptions.value],
    isDefault: false,
    active: true,
    accountId: undefined,
    notionToken: '',
    databaseId: '',
    fieldMapping: {},
  }
  editingOutput.value = null
  notionSchema.value = null
}

// ============================================================================
// CRUD OPERATIONS
// ============================================================================

/**
 * Validate default output constraint
 */
function validateDefaultOutput(newOutputs: FlowOutput[]): { valid: boolean; message?: string } {
  const defaultOutputs = newOutputs.filter(o => o.isDefault)

  if (defaultOutputs.length === 0) {
    return {
      valid: false,
      message: 'At least one output must be marked as default.',
    }
  }

  if (defaultOutputs.length > 1) {
    return {
      valid: false,
      message: 'Only one output can be marked as default.',
    }
  }

  return { valid: true }
}

/**
 * Save new output
 */
async function saveNewOutput() {
  try {
    // Validate form
    const validatedData = outputSchema.value.parse(outputFormState.value)

    // Build output config based on type
    let outputConfig: Record<string, any> = {}

    if (selectedOutputType.value === 'notion') {
      outputConfig = {
        notionToken: outputFormState.value.notionToken,
        databaseId: outputFormState.value.databaseId,
        fieldMapping: outputFormState.value.fieldMapping,
      } as NotionOutputConfig
    }
    // Future: Add GitHub, Linear configs

    // Derive a human-readable name: prefer the Notion database title,
    // fall back to a generic label based on output type.
    const outputName = notionSchema.value?.databaseTitle
      || `${selectedOutputType.value.charAt(0).toUpperCase() + selectedOutputType.value.slice(1)} Output`

    // Create new output object
    const newOutput: FlowOutput = {
      id: `temp-${Date.now()}`, // Temporary ID, will be replaced by DB
      flowId: props.flowId,
      outputType: selectedOutputType.value,
      name: outputName,
      domainFilter: outputFormState.value.domainFilter.length > 0 && !isAllDomainsSelected(outputFormState.value.domainFilter)
        ? outputFormState.value.domainFilter
        : undefined,
      isDefault: outputFormState.value.isDefault,
      outputConfig,
      accountId: outputFormState.value.accountId,
      active: true,
    }

    // Check if we need to unset other defaults
    let updatedOutputs = [...outputs.value]
    if (newOutput.isDefault) {
      updatedOutputs = updatedOutputs.map(o => ({ ...o, isDefault: false }))
    }
    updatedOutputs.push(newOutput)

    // Validate default constraint
    const validation = validateDefaultOutput(updatedOutputs)
    if (!validation.valid) {
      notify.error('Validation Error', { description: validation.message })
      return
    }

    // If in edit mode, save to API
    if (props.editMode) {
      // If setting as default, update other outputs first
      if (newOutput.isDefault) {
        for (const output of outputs.value) {
          if (output.isDefault) {
            await $fetch(`/api/teams/${props.teamId}/triage-outputs/${output.id}`, {
              method: 'PATCH',
              body: { isDefault: false },
            })
          }
        }
      }

      const response = await $fetch(`/api/teams/${props.teamId}/triage-outputs`, {
        method: 'POST',
        body: newOutput,
      })

      // Update local array
      outputs.value = updatedOutputs.map(o =>
        o.id === newOutput.id ? (response as FlowOutput) : o
      )

      notify.success('Output Added', { description: `${selectedOutputType.value.charAt(0).toUpperCase() + selectedOutputType.value.slice(1)} output has been added successfully.` })
    } else {
      // In wizard mode, just add to local array
      outputs.value = updatedOutputs
    }

    // Emit changes
    emit('update:modelValue', outputs.value)
    emit('change', outputs.value)

    // Close modal and reset form
    isAddModalOpen.value = false
    resetForm()
  } catch (error: any) {
    console.error('[OutputManager] Failed to save output:', error)

    // Show validation errors or API errors
    if (error.issues) {
      // Zod validation errors
      const errorMessages = error.issues.map((issue: any) => issue.message).join(', ')
      notify.error('Validation Error', { description: errorMessages })
    } else {
      notify.error('Save Failed', { description: error.message || 'Failed to save output. Please try again.' })
    }
  }
}

/**
 * Update existing output
 */
async function updateOutput() {
  if (!editingOutput.value) return

  try {
    // Validate form
    const validatedData = outputSchema.value.parse(outputFormState.value)

    // Build output config based on type
    let outputConfig: Record<string, any> = {}

    if (selectedOutputType.value === 'notion') {
      outputConfig = {
        notionToken: outputFormState.value.notionToken,
        databaseId: outputFormState.value.databaseId,
        fieldMapping: outputFormState.value.fieldMapping,
      } as NotionOutputConfig
    }
    // Future: Add GitHub, Linear configs

    // Update output object
    const updatedOutput: FlowOutput = {
      ...editingOutput.value,
      domainFilter: outputFormState.value.domainFilter.length > 0 && !isAllDomainsSelected(outputFormState.value.domainFilter)
        ? outputFormState.value.domainFilter
        : undefined,
      isDefault: outputFormState.value.isDefault,
      outputConfig,
      accountId: outputFormState.value.accountId,
      active: outputFormState.value.active,
    }

    // Check if we need to unset other defaults
    let updatedOutputs = outputs.value.map((o: FlowOutput) =>
      o.id === editingOutput.value!.id ? updatedOutput : o
    )
    if (updatedOutput.isDefault) {
      updatedOutputs = updatedOutputs.map((o: FlowOutput) =>
        o.id === updatedOutput.id ? o : { ...o, isDefault: false }
      )
    }

    // Validate default constraint
    const validation = validateDefaultOutput(updatedOutputs)
    if (!validation.valid) {
      notify.error('Validation Error', { description: validation.message })
      return
    }

    // If in edit mode, update via API
    if (props.editMode) {
      // If setting as default, update other outputs first
      if (updatedOutput.isDefault && !editingOutput.value.isDefault) {
        for (const output of outputs.value) {
          if (output.isDefault && output.id !== updatedOutput.id) {
            await $fetch(`/api/teams/${props.teamId}/triage-outputs/${output.id}`, {
              method: 'PATCH',
              body: { isDefault: false },
            })
          }
        }
      }

      const response = await $fetch(`/api/teams/${props.teamId}/triage-outputs/${editingOutput.value.id}`, {
        method: 'PATCH',
        body: updatedOutput,
      })

      // Update local array
      outputs.value = updatedOutputs.map((o: FlowOutput) =>
        o.id === editingOutput.value!.id ? (response as FlowOutput) : o
      )

      notify.success('Output Updated', { description: `${selectedOutputType.value.charAt(0).toUpperCase() + selectedOutputType.value.slice(1)} output has been updated successfully.` })
    } else {
      // In wizard mode, just update local array
      outputs.value = updatedOutputs
    }

    // Emit changes
    emit('update:modelValue', outputs.value)
    emit('change', outputs.value)

    // Close modal and reset form
    isEditModalOpen.value = false
    resetForm()
  } catch (error: any) {
    console.error('[OutputManager] Failed to update output:', error)

    // Show validation errors or API errors
    if (error.issues) {
      const errorMessages = error.issues.map((issue: any) => issue.message).join(', ')
      notify.error('Validation Error', { description: errorMessages })
    } else {
      notify.error('Update Failed', { description: error.message || 'Failed to update output. Please try again.' })
    }
  }
}

/**
 * Delete output
 */
async function deleteOutput() {
  if (!deletingOutput.value) return

  try {
    // Check if deleting the default output
    if (deletingOutput.value.isDefault && outputs.value.length > 1) {
      notify.error('Cannot Delete', { description: 'Cannot delete the default output. Set another output as default first.' })
      return
    }

    // If in edit mode, delete via API
    if (props.editMode) {
      await $fetch(`/api/teams/${props.teamId}/triage-outputs/${deletingOutput.value.id}`, {
        method: 'DELETE',
      })

      notify.success('Output Deleted', { description: `${deletingOutput.value.outputType.charAt(0).toUpperCase() + deletingOutput.value.outputType.slice(1)} output has been deleted.` })
    }

    // Remove from local array
    outputs.value = outputs.value.filter((o: FlowOutput) => o.id !== deletingOutput.value!.id)

    // Emit changes
    emit('update:modelValue', outputs.value)
    emit('change', outputs.value)

    // Close dialog
    isDeleteDialogOpen.value = false
    deletingOutput.value = null
  } catch (error: any) {
    console.error('[OutputManager] Failed to delete output:', error)
    notify.error('Delete Failed', { description: error.message || 'Failed to delete output. Please try again.' })
  }
}

/**
 * Toggle output active status
 */
async function toggleActive(output: FlowOutput) {
  try {
    const updatedOutput = { ...output, active: !output.active }

    // If in edit mode, update via API
    if (props.editMode) {
      await $fetch(`/api/teams/${props.teamId}/triage-outputs/${output.id}`, {
        method: 'PATCH',
        body: { active: updatedOutput.active },
      })
    }

    // Update local array
    const index = outputs.value.findIndex((o: FlowOutput) => o.id === output.id)
    if (index !== -1) {
      outputs.value[index] = updatedOutput
    }

    // Emit changes
    emit('update:modelValue', outputs.value)
    emit('change', outputs.value)
  } catch (error: any) {
    console.error('[OutputManager] Failed to toggle active status:', error)
    notify.error('Update Failed', { description: 'Failed to update output status.' })
  }
}

// ============================================================================
// COMPUTED PROPERTIES
// ============================================================================

/**
 * Get icon for output type
 */
function getOutputTypeIcon(type: string): string {
  switch (type) {
    case 'notion':
      return 'i-lucide-file-text'
    case 'github':
      return 'i-lucide-github'
    case 'linear':
      return 'i-simple-icons-linear'
    default:
      return 'i-lucide-layers'
  }
}

/**
 * Get color for output type
 */
type BadgeColor = 'error' | 'info' | 'success' | 'warning' | 'primary' | 'secondary' | 'neutral'

function getOutputTypeColor(type: string): BadgeColor {
  switch (type) {
  case 'notion':
      return 'neutral'
    case 'github':
      return 'neutral'
    case 'linear':
      return 'info'
    default:
      return 'neutral'
  }
}

/**
 * Format domain filter for display
 */
function formatDomainFilter(domainFilter?: string[]): string {
  if (!domainFilter || domainFilter.length === 0) {
    return 'All domains'
  }
  return domainFilter.join(', ')
}

// ============================================================================
// WATCHERS
// ============================================================================

// Watch for external changes to modelValue
watch(() => props.modelValue, (newValue) => {
  outputs.value = [...newValue]
}, { deep: true })

// Auto-open add modal when autoAddType is set
watch(() => props.autoAddType, (type) => {
  if (type) {
    openAddModal(type)
  }
}, { immediate: true })

// Auto-open edit modal when autoEditOutput is set
watch(() => props.autoEditOutput, (output) => {
  if (output) {
    openEditModal(output)
  }
}, { immediate: true })

// Notify parent when auto-opened modal closes
watch(isAddModalOpen, (open) => {
  if (!open && props.autoAddType) {
    emit('auto-add-closed')
  }
})

watch(isEditModalOpen, (open) => {
  if (!open && props.autoEditOutput) {
    emit('auto-edit-closed')
  }
})
</script>

<template>
  <div class="space-y-4">
    <!-- Header -->
    <div class="flex items-center justify-between">
      <div>
        <h3 class="text-lg font-semibold">Outputs</h3>
        <p class="text-sm text-gray-500">
          Configure where tasks should be created
        </p>
      </div>

      <!-- Add Output Button -->
      <UDropdownMenu :items="[outputTypeOptions]">
        <UButton
          icon="i-lucide-plus"
          color="primary"
          label="Add Output"
        />
      </UDropdownMenu>
    </div>

    <!-- Outputs List -->
    <div v-if="outputs.length === 0" class="text-center py-8 text-gray-500">
      <div class="i-lucide-layers text-4xl mb-2 mx-auto" />
      <p>No outputs configured yet.</p>
      <p class="text-sm">Add at least one output to route tasks.</p>
    </div>

    <div v-else class="space-y-3">
      <UCard
        v-for="output in outputs"
        :key="output.id"
        class="relative"
      >
        <div class="flex items-start justify-between">
          <!-- Output Info -->
          <div class="flex-1">
            <div class="flex items-center gap-2 mb-2">
              <UBadge
                :icon="getOutputTypeIcon(output.outputType)"
                :color="getOutputTypeColor(output.outputType)"
                variant="subtle"
              >
                {{ output.outputType }}
              </UBadge>

              <UBadge
                v-if="output.isDefault"
                color="primary"
                variant="subtle"
              >
                Default
              </UBadge>

              <UBadge
                v-if="!output.active"
                color="neutral"
                variant="subtle"
              >
                Inactive
              </UBadge>
            </div>

            <h4 class="font-semibold">{{ output.outputType.charAt(0).toUpperCase() + output.outputType.slice(1) }}</h4>

            <div class="mt-2 space-y-1 text-sm text-gray-600">
              <div class="flex items-center gap-1">
                <span class="i-lucide-filter" />
                <span>{{ formatDomainFilter(output.domainFilter) }}</span>
              </div>

              <div v-if="output.outputType === 'notion'" class="flex items-center gap-1">
                <span class="i-lucide-database" />
                <span class="font-mono text-xs">
                  {{ (output.outputConfig as NotionOutputConfig).databaseId }}
                </span>
              </div>
            </div>
          </div>

          <!-- Actions -->
          <div class="flex items-center gap-2">
            <USwitch
              :model-value="output.active"
              @update:model-value="toggleActive(output)"
            />

            <UButton
              icon="i-lucide-pencil"
              color="neutral"
              variant="ghost"
              size="sm"
              @click="openEditModal(output)"
            />

            <UButton
              icon="i-lucide-trash-2"
              color="error"
              variant="ghost"
              size="sm"
              @click="openDeleteDialog(output)"
            />
          </div>
        </div>
      </UCard>
    </div>

    <!-- Validation Warning -->
    <UAlert
      v-if="outputs.length > 0 && !outputs.some((o: FlowOutput) => o.isDefault)"
      color="warning"
      icon="i-lucide-triangle-alert"
      title="No Default Output"
      description="At least one output must be marked as default to handle tasks with no domain match."
    />

    <!-- Add Output Modal -->
    <UModal v-model:open="isAddModalOpen">
      <template #content="{ close }">
        <div class="p-6">
          <h3 class="text-lg font-semibold mb-4">
            Add {{ selectedOutputType }} Output
          </h3>

          <div class="space-y-4">
            <!-- Domain Filter -->
            <UFormField
              label="Domain Filter"
              name="domainFilter"
              help="Deselect domains to exclude them from this output."
            >
              <CroutonTriageSharedDomainPicker v-model="outputFormState.domainFilter" />
            </UFormField>

            <!-- Default Output -->
            <UFormField name="isDefault">
              <UCheckbox
                v-model="outputFormState.isDefault"
                label="Set as default output"
                help="The default output is the fallback destination. Tasks that don't match any domain filter, or tasks with no detected domain, will be routed here. Only one output can be the default."
              />
            </UFormField>

            <!-- Notion Configuration -->
            <div v-if="selectedOutputType === 'notion'" class="space-y-4 pt-4 border-t">
              <h4 class="font-semibold text-sm">Notion Configuration</h4>

              <!-- Connected Account Picker -->
              <UFormField label="Connected Account" name="accountId">
                <CroutonTriageFlowsAccountPicker
                  ref="accountPickerRef"
                  v-model="outputFormState.accountId"
                  provider="notion"
                  :team-id="teamId"
                  placeholder="Select Notion account..."
                  @connect-new="openConnectAccountModal"
                />
              </UFormField>

              <!-- Inline token: shown when no account selected -->
              <UFormField v-if="!outputFormState.accountId" label="Notion API Token" name="notionToken">
                <UInput
                  v-model="outputFormState.notionToken"
                  type="password"
                  placeholder="secret_..."
                  class="w-full"
                />
                <template #help>
                  Or select a connected account above.
                </template>
              </UFormField>

              <UFormField label="Database ID" name="databaseId" required>
                <UInput
                  v-model="outputFormState.databaseId"
                  placeholder="32 character ID (no dashes)"
                  class="w-full"
                />
              </UFormField>

              <UButton
                icon="i-lucide-refresh-cw"
                :loading="schemaLoading"
                @click="fetchNotionSchemaAndMap"
              >
                Fetch Schema & Auto-Map Fields
              </UButton>

              <UAlert
                v-if="schemaError"
                color="error"
                icon="i-lucide-circle-alert"
                :title="schemaError"
              />

              <!-- Existing Mapping Summary (when schema not loaded) -->
              <div v-if="!notionSchema && hasExistingMappings" class="space-y-2 pt-4 border-t">
                <h5 class="font-semibold text-sm">Active Field Mappings</h5>
                <div class="text-sm text-[var(--ui-text-muted)] space-y-1">
                  <div v-if="getMappedProperty('priority')">Priority &rarr; {{ getMappedProperty('priority') }}</div>
                  <div v-if="getMappedProperty('type')">Type &rarr; {{ getMappedProperty('type') }}</div>
                  <div v-if="getMappedProperty('assignee')">Assignee &rarr; {{ getMappedProperty('assignee') }}</div>
                </div>
                <p class="text-xs text-[var(--ui-text-dimmed)]">Fetch schema to edit mappings.</p>
              </div>

              <!-- Field Mapping (if schema loaded) -->
              <div v-if="notionSchema" class="space-y-3 pt-4 border-t">
                <h5 class="font-semibold text-sm">Field Mapping</h5>
                <p class="text-xs text-[var(--ui-text-dimmed)]">Select "None" to prevent the bot from setting a field.</p>

                <!-- Priority Mapping -->
                <UFormField label="Priority Field" name="priority">
                  <USelectMenu
                    :model-value="getMappedProperty('priority') || '(none)'"
                    :items="notionPropertyOptions"
                    class="w-full"
                    @update:model-value="updateFieldMapping('priority', $event)"
                  >
                    <template #item="{ item }">
                      <div v-if="item === '(none)'" class="text-[var(--ui-text-dimmed)] italic">None</div>
                      <div v-else class="flex items-center gap-2">
                        <span>{{ item }}</span>
                        <UBadge
                          :color="getPropertyTypeColor(notionSchema.properties[item!]?.type ?? '') as BadgeColor"
                          size="xs"
                          variant="subtle"
                        >
                          {{ notionSchema.properties[item]?.type }}
                        </UBadge>
                      </div>
                    </template>
                  </USelectMenu>
                </UFormField>

                <!-- Type Mapping -->
                <UFormField label="Type Field" name="type">
                  <USelectMenu
                    :model-value="getMappedProperty('type') || '(none)'"
                    :items="notionPropertyOptions"
                    class="w-full"
                    @update:model-value="updateFieldMapping('type', $event)"
                  >
                    <template #item="{ item }">
                      <div v-if="item === '(none)'" class="text-[var(--ui-text-dimmed)] italic">None</div>
                      <div v-else class="flex items-center gap-2">
                        <span>{{ item }}</span>
                        <UBadge
                          :color="getPropertyTypeColor(notionSchema.properties[item!]?.type ?? '') as BadgeColor"
                          size="xs"
                          variant="subtle"
                        >
                          {{ notionSchema.properties[item]?.type }}
                        </UBadge>
                      </div>
                    </template>
                  </USelectMenu>
                </UFormField>

                <!-- Assignee Mapping -->
                <UFormField label="Assignee Field" name="assignee">
                  <USelectMenu
                    :model-value="getMappedProperty('assignee') || '(none)'"
                    :items="notionPropertyOptions"
                    class="w-full"
                    @update:model-value="updateFieldMapping('assignee', $event)"
                  >
                    <template #item="{ item }">
                      <div v-if="item === '(none)'" class="text-[var(--ui-text-dimmed)] italic">None</div>
                      <div v-else class="flex items-center gap-2">
                        <span>{{ item }}</span>
                        <UBadge
                          :color="getPropertyTypeColor(notionSchema.properties[item!]?.type ?? '') as BadgeColor"
                          size="xs"
                          variant="subtle"
                        >
                          {{ notionSchema.properties[item]?.type }}
                        </UBadge>
                      </div>
                    </template>
                  </USelectMenu>
                </UFormField>

                <UAlert
                  icon="i-lucide-info"
                  color="info"
                  title="User Mapping"
                  description="For people properties, configure user mappings to map Slack/Figma users to Notion users."
                />
              </div>
            </div>

            <!-- GitHub Configuration (Future) -->
            <div v-if="selectedOutputType === 'github'" class="space-y-4 pt-4 border-t">
              <UAlert
                color="info"
                icon="i-lucide-info"
                title="Coming Soon"
                description="GitHub output configuration will be available in a future update."
              />
            </div>

            <!-- Linear Configuration (Future) -->
            <div v-if="selectedOutputType === 'linear'" class="space-y-4 pt-4 border-t">
              <UAlert
                color="info"
                icon="i-lucide-info"
                title="Coming Soon"
                description="Linear output configuration will be available in a future update."
              />
            </div>
          </div>

          <!-- Actions -->
          <div class="flex justify-end gap-2 mt-6">
            <UButton
              color="neutral"
              variant="ghost"
              @click="close"
            >
              Cancel
            </UButton>
            <UButton
              color="primary"
              @click="saveNewOutput"
            >
              Add Output
            </UButton>
          </div>
        </div>
      </template>
    </UModal>

    <!-- Edit Output Modal -->
    <UModal v-model:open="isEditModalOpen">
      <template #content="{ close }">
        <div class="p-6">
          <h3 class="text-lg font-semibold mb-4">
            Edit {{ selectedOutputType }} Output
          </h3>

          <div class="space-y-4">
            <!-- Domain Filter -->
            <UFormField
              label="Domain Filter"
              name="domainFilter"
              help="Deselect domains to exclude them from this output."
            >
              <CroutonTriageSharedDomainPicker v-model="outputFormState.domainFilter" />
            </UFormField>

            <!-- Default Output -->
            <UFormField name="isDefault">
              <UCheckbox
                v-model="outputFormState.isDefault"
                label="Set as default output"
                help="The default output is the fallback destination. Tasks that don't match any domain filter, or tasks with no detected domain, will be routed here. Only one output can be the default."
              />
            </UFormField>

            <!-- Active Status -->
            <UFormField name="active">
              <UCheckbox
                v-model="outputFormState.active"
                label="Active"
                help="Inactive outputs will not receive tasks"
              />
            </UFormField>

            <!-- Notion Configuration -->
            <div v-if="selectedOutputType === 'notion'" class="space-y-4 pt-4 border-t">
              <h4 class="font-semibold text-sm">Notion Configuration</h4>

              <!-- Connected Account Picker -->
              <UFormField label="Connected Account" name="accountId">
                <CroutonTriageFlowsAccountPicker
                  ref="accountPickerRef"
                  v-model="outputFormState.accountId"
                  provider="notion"
                  :team-id="teamId"
                  placeholder="Select Notion account..."
                  @connect-new="openConnectAccountModal"
                />
              </UFormField>

              <!-- Inline token: shown when no account selected -->
              <UFormField v-if="!outputFormState.accountId" label="Notion API Token" name="notionToken">
                <UInput
                  v-model="outputFormState.notionToken"
                  type="password"
                  placeholder="secret_..."
                  class="w-full"
                />
                <template #help>
                  Or select a connected account above.
                </template>
              </UFormField>

              <UFormField label="Database ID" name="databaseId" required>
                <UInput
                  v-model="outputFormState.databaseId"
                  placeholder="32 character ID (no dashes)"
                  class="w-full"
                />
              </UFormField>

              <UButton
                icon="i-lucide-refresh-cw"
                :loading="schemaLoading"
                @click="fetchNotionSchemaAndMap"
              >
                Fetch Schema & Auto-Map Fields
              </UButton>

              <UAlert
                v-if="schemaError"
                color="error"
                icon="i-lucide-circle-alert"
                :title="schemaError"
              />

              <!-- Existing Mapping Summary (when schema not loaded) -->
              <div v-if="!notionSchema && hasExistingMappings" class="space-y-2 pt-4 border-t">
                <h5 class="font-semibold text-sm">Active Field Mappings</h5>
                <div class="text-sm text-[var(--ui-text-muted)] space-y-1">
                  <div v-if="getMappedProperty('priority')">Priority &rarr; {{ getMappedProperty('priority') }}</div>
                  <div v-if="getMappedProperty('type')">Type &rarr; {{ getMappedProperty('type') }}</div>
                  <div v-if="getMappedProperty('assignee')">Assignee &rarr; {{ getMappedProperty('assignee') }}</div>
                </div>
                <p class="text-xs text-[var(--ui-text-dimmed)]">Fetch schema to edit mappings.</p>
              </div>

              <!-- Field Mapping (if schema loaded) -->
              <div v-if="notionSchema" class="space-y-3 pt-4 border-t">
                <h5 class="font-semibold text-sm">Field Mapping</h5>
                <p class="text-xs text-[var(--ui-text-dimmed)]">Select "None" to prevent the bot from setting a field.</p>

                <!-- Priority Mapping -->
                <UFormField label="Priority Field" name="priority">
                  <USelectMenu
                    :model-value="getMappedProperty('priority') || '(none)'"
                    :items="notionPropertyOptions"
                    class="w-full"
                    @update:model-value="updateFieldMapping('priority', $event)"
                  >
                    <template #item="{ item }">
                      <div v-if="item === '(none)'" class="text-[var(--ui-text-dimmed)] italic">None</div>
                      <div v-else class="flex items-center gap-2">
                        <span>{{ item }}</span>
                        <UBadge
                          :color="getPropertyTypeColor(notionSchema.properties[item!]?.type ?? '') as BadgeColor"
                          size="xs"
                          variant="subtle"
                        >
                          {{ notionSchema.properties[item]?.type }}
                        </UBadge>
                      </div>
                    </template>
                  </USelectMenu>
                </UFormField>

                <!-- Type Mapping -->
                <UFormField label="Type Field" name="type">
                  <USelectMenu
                    :model-value="getMappedProperty('type') || '(none)'"
                    :items="notionPropertyOptions"
                    class="w-full"
                    @update:model-value="updateFieldMapping('type', $event)"
                  >
                    <template #item="{ item }">
                      <div v-if="item === '(none)'" class="text-[var(--ui-text-dimmed)] italic">None</div>
                      <div v-else class="flex items-center gap-2">
                        <span>{{ item }}</span>
                        <UBadge
                          :color="getPropertyTypeColor(notionSchema.properties[item!]?.type ?? '') as BadgeColor"
                          size="xs"
                          variant="subtle"
                        >
                          {{ notionSchema.properties[item]?.type }}
                        </UBadge>
                      </div>
                    </template>
                  </USelectMenu>
                </UFormField>

                <!-- Assignee Mapping -->
                <UFormField label="Assignee Field" name="assignee">
                  <USelectMenu
                    :model-value="getMappedProperty('assignee') || '(none)'"
                    :items="notionPropertyOptions"
                    class="w-full"
                    @update:model-value="updateFieldMapping('assignee', $event)"
                  >
                    <template #item="{ item }">
                      <div v-if="item === '(none)'" class="text-[var(--ui-text-dimmed)] italic">None</div>
                      <div v-else class="flex items-center gap-2">
                        <span>{{ item }}</span>
                        <UBadge
                          :color="getPropertyTypeColor(notionSchema.properties[item!]?.type ?? '') as BadgeColor"
                          size="xs"
                          variant="subtle"
                        >
                          {{ notionSchema.properties[item]?.type }}
                        </UBadge>
                      </div>
                    </template>
                  </USelectMenu>
                </UFormField>

                <UAlert
                  icon="i-lucide-info"
                  color="info"
                  title="User Mapping"
                  description="For people properties, configure user mappings to map Slack/Figma users to Notion users."
                />
              </div>
            </div>
          </div>

          <!-- Actions -->
          <div class="flex justify-end gap-2 mt-6">
            <UButton
              color="neutral"
              variant="ghost"
              @click="close"
            >
              Cancel
            </UButton>
            <UButton
              color="primary"
              @click="updateOutput"
            >
              Save Changes
            </UButton>
          </div>
        </div>
      </template>
    </UModal>

    <!-- Connect Account Modal -->
    <UModal v-model:open="showConnectAccountModal">
      <template #content="{ close }">
        <div class="p-6">
          <h3 class="text-lg font-semibold mb-4">
            Connect Notion Account
          </h3>

          <div class="space-y-4">
            <UFormField label="Label" name="label" required>
              <UInput
                v-model="connectAccountForm.label"
                placeholder="e.g., Design Team Notion"
                class="w-full"
              />
            </UFormField>

            <UFormField label="API Token" name="token" required>
              <UInput
                v-model="connectAccountForm.token"
                type="password"
                placeholder="secret_... or ntn_..."
                class="w-full"
              />
              <template #help>
                Paste your Notion integration token. It will be encrypted at rest.
              </template>
            </UFormField>
          </div>

          <div class="flex justify-end gap-2 mt-6">
            <UButton color="neutral" variant="ghost" @click="close">
              Cancel
            </UButton>
            <UButton
              color="primary"
              :loading="connectingAccount"
              @click="handleConnectAccount"
            >
              Connect
            </UButton>
          </div>
        </div>
      </template>
    </UModal>

    <!-- Delete Confirmation Dialog -->
    <UModal v-model:open="isDeleteDialogOpen">
      <template #content="{ close }">
        <div class="p-6">
          <div class="flex items-start gap-3 mb-4">
            <div class="i-lucide-triangle-alert text-2xl text-red-500" />
            <div>
              <h3 class="text-lg font-semibold">Delete Output</h3>
              <p class="text-sm text-gray-600 mt-1">
                Are you sure you want to delete this {{ deletingOutput?.outputType }} output?
                This action cannot be undone.
              </p>
            </div>
          </div>

          <div class="flex justify-end gap-2">
            <UButton
              color="neutral"
              variant="ghost"
              @click="close"
            >
              Cancel
            </UButton>
            <UButton
              color="error"
              @click="deleteOutput"
            >
              Delete Output
            </UButton>
          </div>
        </div>
      </template>
    </UModal>
  </div>
</template>
