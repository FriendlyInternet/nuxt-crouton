<script setup lang="ts">
// @ts-expect-error - layer types resolved at app level
import type { Flow } from '#layers/triage/types'

interface Props {
  teamId: string
  modelValue: boolean
  flow: Flow | null
}

const props = defineProps<Props>()

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  'save': [settings: Partial<Flow>]
}>()

const isOpen = computed({
  get: () => props.modelValue,
  set: (val) => emit('update:modelValue', val),
})

const notify = useNotify()
const saving = ref(false)

// Default domains for new flows
const DEFAULT_DOMAINS = ['design', 'frontend', 'backend', 'product', 'infrastructure', 'docs']

// Form state initialized from flow (anthropicApiKey is never returned from server)
const formState = ref({
  name: props.flow?.name || '',
  aiSummaryPrompt: props.flow?.aiSummaryPrompt || '',
  aiTaskPrompt: props.flow?.aiTaskPrompt || '',
  replyPersonality: props.flow?.replyPersonality || '',
  personalityIcon: props.flow?.personalityIcon || '',
  availableDomains: props.flow?.availableDomains || [...DEFAULT_DOMAINS],
})

// API key management — key is encrypted at rest, we only show the hint
const hasExistingKey = ref(!!props.flow?.anthropicApiKeyHint)
const apiKeyHint = ref(props.flow?.anthropicApiKeyHint || '')
const isChangingKey = ref(false)
const newApiKey = ref('')

// Sync form when flow changes
watch(() => props.flow, (flow) => {
  if (flow) {
    formState.value = {
      name: flow.name || '',
      aiSummaryPrompt: flow.aiSummaryPrompt || '',
      aiTaskPrompt: flow.aiTaskPrompt || '',
      replyPersonality: flow.replyPersonality || '',
      personalityIcon: flow.personalityIcon || '',
      availableDomains: flow.availableDomains || [...DEFAULT_DOMAINS],
    }
    hasExistingKey.value = !!flow.anthropicApiKeyHint
    apiKeyHint.value = flow.anthropicApiKeyHint || ''
    isChangingKey.value = false
    newApiKey.value = ''
    selectedPreset.value = detectPresetFromPrompts(flow.aiSummaryPrompt, flow.aiTaskPrompt)
    // Sync personality ref
    const rp = flow.replyPersonality
    selectedPersonality.value = !rp ? 'professional' : rp.startsWith('custom:') ? 'custom' : rp
    // Ensure personality icon is set from preset (watcher won't fire if value didn't change)
    const preset = personalityPresets.find(p => p.value === selectedPersonality.value)
    if (preset && selectedPersonality.value !== 'custom') {
      formState.value.personalityIcon = preset.icon
    }
  }
}, { deep: true })

// Prompt presets
const promptPresets = [
  {
    label: 'Balanced',
    value: 'default',
    icon: 'i-lucide-scale',
    description: 'General-purpose analysis',
    summaryPrompt: '',
    taskPrompt: '',
  },
  {
    label: 'Technical',
    value: 'technical',
    icon: 'i-lucide-code',
    description: 'Implementation details & architecture',
    summaryPrompt: 'Focus on technical details, implementation specifics, and architectural considerations.',
    taskPrompt: 'Extract highly specific technical tasks with clear acceptance criteria.',
  },
  {
    label: 'Product',
    value: 'product',
    icon: 'i-lucide-lightbulb',
    description: 'User needs & business value',
    summaryPrompt: 'Focus on user needs, business value, and product strategy.',
    taskPrompt: 'Extract user stories and product requirements with clear value propositions.',
  },
  {
    label: 'Design',
    value: 'design',
    icon: 'i-lucide-palette',
    description: 'Visual design & user experience',
    summaryPrompt: 'Focus on visual design, user experience, and interface patterns.',
    taskPrompt: 'Extract design tasks with specific deliverables and design system references.',
  },
]

function detectPresetFromPrompts(summaryPrompt?: string, taskPrompt?: string): string {
  if (!summaryPrompt && !taskPrompt) return 'default'
  for (const preset of promptPresets) {
    if (preset.value === 'default') continue
    if (preset.summaryPrompt === summaryPrompt && preset.taskPrompt === taskPrompt) {
      return preset.value
    }
  }
  return 'custom'
}

const selectedPreset = ref(detectPresetFromPrompts(props.flow?.aiSummaryPrompt, props.flow?.aiTaskPrompt))

// Standalone toggle — not tied to preset selection
const showCustomPrompts = ref(selectedPreset.value === 'custom')

watch(selectedPreset, (preset) => {
  const selected = promptPresets.find(p => p.value === preset)
  if (selected) {
    formState.value.aiSummaryPrompt = selected.summaryPrompt
    formState.value.aiTaskPrompt = selected.taskPrompt
  }
})

// Reply personality presets
const personalityPresets = [
  { value: 'professional', label: 'Professional', icon: '💼', description: 'Formal, clear, minimal' },
  { value: 'friendly', label: 'Friendly', icon: '👋', description: 'Warm, encouraging' },
  { value: 'concise', label: 'Concise', icon: '⚡', description: 'Ultra-brief' },
  { value: 'custom', label: 'Custom', icon: '✏️', description: 'Write your own' },
]

// Example responses for each personality
const personalityExamples: Record<string, string> = {
  professional: 'I\'ve created a task for the login page redesign. Priority is set to high with 3 action items identified.',
  friendly: 'Hey team! I\'ve turned this into a task — looks like a great idea! I spotted 3 action items we can tackle.',
  concise: 'Task created. 3 items. High priority.',
}

// Custom personality
const customPersonalityPrompt = ref(
  props.flow?.replyPersonality?.startsWith('custom:')
    ? props.flow.replyPersonality.replace(/^custom:/, '')
    : ''
)

const selectedPersonality = ref((() => {
  const rp = props.flow?.replyPersonality
  if (!rp) return 'professional'
  if (rp.startsWith('custom:')) return 'custom'
  return rp
})())

const isCustomPersonality = computed(() => selectedPersonality.value === 'custom')

// Sync personality selection to formState + icon (immediate so default preset icon is set)
watch(selectedPersonality, (val) => {
  const preset = personalityPresets.find(p => p.value === val)
  if (val === 'custom') {
    formState.value.replyPersonality = customPersonalityPrompt.value
      ? `custom:${customPersonalityPrompt.value}`
      : 'custom'
  } else if (val === 'professional') {
    formState.value.replyPersonality = ''
  } else {
    formState.value.replyPersonality = val
  }
  // Set the personality icon from the preset emoji (unless custom)
  if (preset && val !== 'custom') {
    formState.value.personalityIcon = preset.icon
  }
}, { immediate: true })

watch(customPersonalityPrompt, (val) => {
  if (isCustomPersonality.value) {
    formState.value.replyPersonality = val ? `custom:${val}` : 'custom'
  }
})

// Domain management
const newDomain = ref('')

function addDomain() {
  const domain = newDomain.value.toLowerCase().trim()
  if (domain && !formState.value.availableDomains.includes(domain)) {
    formState.value.availableDomains.push(domain)
  }
  newDomain.value = ''
}

function removeDomain(domain: string) {
  formState.value.availableDomains = formState.value.availableDomains.filter((d: any) => d !== domain)
}

// Icon suggestions
interface IconSuggestion {
  icon: string
  type: 'emoji' | 'lucide' | 'svg'
  label: string
}

const iconSuggestions = ref<IconSuggestion[]>([])
const loadingIcons = ref(false)

async function suggestIcons() {
  if (!customPersonalityPrompt.value || customPersonalityPrompt.value.length < 3) return

  loadingIcons.value = true
  try {
    const response = await $fetch<{ suggestions: IconSuggestion[] }>(
      `/api/crouton-triage/teams/${props.teamId}/ai/suggest-icons`,
      {
        method: 'POST',
        body: {
          description: customPersonalityPrompt.value,
          flowId: props.flow?.id,
        },
      }
    )
    iconSuggestions.value = response.suggestions
  } catch {
    iconSuggestions.value = [
      { icon: '🤖', type: 'emoji', label: 'Robot' },
      { icon: '💬', type: 'emoji', label: 'Chat' },
      { icon: '✨', type: 'emoji', label: 'Sparkles' },
    ]
  } finally {
    loadingIcons.value = false
  }
}

// Prompt preview
const { buildPreview } = useTriagePromptPreview()
const showPreview = ref(false)
const promptPreview = computed(() => buildPreview(
  formState.value.aiSummaryPrompt,
  formState.value.aiTaskPrompt
))

// Save handler
async function handleSave() {
  if (!props.flow?.id) return

  saving.value = true
  try {
    const { currentTeam } = useTeam()
    await $fetch(`/api/teams/${currentTeam.value?.id}/triage-flows/${props.flow.id}`, {
      method: 'PATCH',
      body: {
        aiEnabled: true,
        name: formState.value.name?.trim() || undefined,
        // Only send API key when user is setting a new one
        ...(newApiKey.value && { anthropicApiKey: newApiKey.value }),
        aiSummaryPrompt: formState.value.aiSummaryPrompt || undefined,
        aiTaskPrompt: formState.value.aiTaskPrompt || undefined,
        replyPersonality: formState.value.replyPersonality || undefined,
        personalityIcon: formState.value.personalityIcon || undefined,
        availableDomains: formState.value.availableDomains,
      },
    })

    // Reset key input state after successful save
    if (newApiKey.value) {
      hasExistingKey.value = true
      isChangingKey.value = false
      newApiKey.value = ''
    }

    emit('save', formState.value)
    isOpen.value = false

    notify.success('AI Settings Saved', { description: 'AI configuration updated successfully.' })
  } catch (error: any) {
    notify.error('Save Failed', { description: error.message || 'Failed to save AI settings.' })
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <CroutonTriageConfigPanel v-model="isOpen" title="Triage Settings" mode="modal">
    <template #default="{ close }">
      <div class="space-y-8">
        <!-- Flow Name -->
        <UFormField label="Flow Name" help="A human-readable name for this triage flow, shown in the pipeline diagram and flow list.">
          <UInput
            v-model="formState.name"
            placeholder="e.g. Engineering Triage"
            size="sm"
            class="w-full"
          />
        </UFormField>

        <!-- API Key -->
        <div>
          <div v-if="hasExistingKey && !isChangingKey" class="flex items-center gap-2">
            <div class="flex items-center gap-1.5">
              <div class="w-2 h-2 rounded-full bg-green-500" />
              <code class="text-xs text-muted-foreground font-mono">{{ apiKeyHint }}</code>
            </div>
            <button class="text-xs text-muted-foreground hover:text-foreground transition-colors cursor-pointer" @click="isChangingKey = true">
              Change
            </button>
          </div>
          <UFormField v-else label="Anthropic API Key" help="Optional. If not provided, the server-configured NUXT_CROUTON_TRIAGE_ANTHROPIC_API_KEY will be used instead. Per-flow keys are encrypted before being stored in the database and are never returned to the client — only a masked hint (e.g. sk-ant-...xyz) is shown.">
            <div class="flex gap-2">
              <UInput
                v-model="newApiKey"
                type="password"
                placeholder="sk-ant-..."
                size="sm"
                class="flex-1"
              />
              <UButton
                v-if="hasExistingKey"
                size="sm"
                variant="ghost"
                color="neutral"
                @click="isChangingKey = false; newApiKey = ''"
              >
                Cancel
              </UButton>
            </div>
          </UFormField>
        </div>

        <USeparator />

        <!-- Analysis Preset -->
        <UFormField label="Analysis Focus">
          <div class="space-y-3">
            <div class="grid grid-cols-2 gap-1.5">
              <button
                v-for="preset in promptPresets"
                :key="preset.value"
                class="flex items-center gap-2 px-3 py-2 rounded-lg text-left text-sm transition-all cursor-pointer"
                :class="selectedPreset === preset.value
                  ? 'bg-primary/10 text-primary ring-1 ring-primary/30'
                  : 'bg-muted/50 text-muted-foreground hover:bg-muted'"
                @click="selectedPreset = preset.value"
              >
                <UIcon :name="preset.icon" class="w-4 h-4 flex-shrink-0" />
                <div class="min-w-0">
                  <div class="font-medium text-xs">{{ preset.label }}</div>
                  <div class="text-[11px] opacity-70 truncate">{{ preset.description }}</div>
                </div>
              </button>
            </div>

            <!-- Toggle buttons -->
            <div class="flex gap-1">
              <UButton
                size="xs"
                variant="soft"
                :color="showCustomPrompts ? 'primary' : 'neutral'"
                @click="showCustomPrompts = !showCustomPrompts"
              >
                Customize
              </UButton>
              <UButton
                size="xs"
                variant="soft"
                :color="showPreview ? 'primary' : 'neutral'"
                @click="showPreview = !showPreview"
              >
                Preview
              </UButton>
            </div>

            <!-- Custom prompts (only when custom preset) -->
            <template v-if="showCustomPrompts">
              <UFormField label="Summary prompt">
                <UTextarea
                  v-model="formState.aiSummaryPrompt"
                  :rows="2"
                  placeholder="Focus on..."
                  size="sm"
                  :ui="{ base: 'text-dimmed' }"
                  class="w-full"
                />
              </UFormField>
              <UFormField label="Task detection prompt">
                <UTextarea
                  v-model="formState.aiTaskPrompt"
                  :rows="2"
                  placeholder="Extract..."
                  size="sm"
                  :ui="{ base: 'text-dimmed' }"
                  class="w-full"
                />
              </UFormField>
            </template>

            <div v-if="showPreview" class="space-y-2">
              <div>
                <p class="text-[11px] text-muted-foreground/70 mb-1">Summary prompt <span class="opacity-60">(~{{ promptPreview.summaryTokenEstimate }} tokens)</span></p>
                <pre class="p-3 text-xs bg-muted/50 rounded-lg max-h-32 overflow-y-auto whitespace-pre-wrap text-muted-foreground leading-relaxed">{{ promptPreview.summaryPrompt }}</pre>
              </div>
              <div>
                <p class="text-[11px] text-muted-foreground/70 mb-1">Task prompt <span class="opacity-60">(~{{ promptPreview.taskTokenEstimate }} tokens)</span></p>
                <pre class="p-3 text-xs bg-muted/50 rounded-lg max-h-32 overflow-y-auto whitespace-pre-wrap text-muted-foreground leading-relaxed">{{ promptPreview.taskPrompt }}</pre>
              </div>
            </div>
          </div>
        </UFormField>

        <USeparator />

        <!-- Reply Personality -->
        <UFormField label="Reply Personality">
          <div class="space-y-3">
            <div class="grid grid-cols-4 gap-1.5">
              <button
                v-for="p in personalityPresets"
                :key="p.value"
                class="flex flex-col items-center gap-1 px-2 py-2 rounded-lg text-center transition-all cursor-pointer"
                :class="selectedPersonality === p.value
                  ? 'bg-primary/10 text-primary ring-1 ring-primary/30'
                  : 'bg-muted/50 text-muted-foreground hover:bg-muted'"
                @click="selectedPersonality = p.value"
              >
                <span class="text-base leading-none">{{ p.icon }}</span>
                <span class="text-[11px] font-medium">{{ p.label }}</span>
              </button>
            </div>

            <!-- Example response -->
            <div v-if="personalityExamples[selectedPersonality]" class="rounded-lg bg-muted/30 px-3 py-2 text-xs text-muted-foreground italic">
              "{{ personalityExamples[selectedPersonality] }}"
            </div>

            <!-- Custom personality -->
            <template v-if="isCustomPersonality">
              <UTextarea
                v-model="customPersonalityPrompt"
                :rows="2"
                placeholder="Describe the personality..."
                size="sm"
                class="w-full"
              />

              <!-- Icon suggestions -->
              <div class="flex items-center gap-2">
                <button
                  class="text-xs text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
                  :class="{ 'opacity-50 pointer-events-none': loadingIcons }"
                  @click="suggestIcons"
                >
                  {{ loadingIcons ? 'Suggesting...' : 'Suggest icon' }}
                </button>
                <span
                  v-if="formState.personalityIcon"
                  class="text-lg cursor-pointer hover:opacity-50 transition-opacity"
                  @click="formState.personalityIcon = ''"
                >
                  {{ formState.personalityIcon }}
                </span>
              </div>

              <div v-if="iconSuggestions.length" class="flex gap-1.5">
                <button
                  v-for="suggestion in iconSuggestions"
                  :key="suggestion.icon"
                  class="text-xl p-1.5 rounded-lg hover:bg-muted transition-colors cursor-pointer"
                  :class="{ 'ring-2 ring-primary bg-primary/10': formState.personalityIcon === suggestion.icon }"
                  :title="suggestion.label"
                  @click="formState.personalityIcon = suggestion.icon"
                >
                  {{ suggestion.icon }}
                </button>
              </div>
            </template>
          </div>
        </UFormField>

        <USeparator />

        <!-- Domains -->
        <UFormField label="Domains" help="AI routes tasks to outputs matching these domains.">
          <CroutonTriageSharedDomainPicker
            v-model="formState.availableDomains"
            creatable
          />
        </UFormField>

        <!-- Save button -->
        <div class="flex justify-end gap-2 pt-3 border-t border-muted/50">
          <UButton color="neutral" variant="ghost" size="sm" @click="close">Cancel</UButton>
          <UButton color="primary" size="sm" :loading="saving" @click="handleSave">Save</UButton>
        </div>
      </div>
    </template>
  </CroutonTriageConfigPanel>
</template>
