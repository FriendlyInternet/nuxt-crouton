<script setup lang="ts">
import type { Flow, FlowInput, FlowOutput } from '../types'

interface Props {
  flow: Flow | null
  inputs?: FlowInput[]
  outputs?: FlowOutput[]
}

const props = withDefaults(defineProps<Props>(), {
  inputs: () => [],
  outputs: () => [],
})

const emit = defineEmits<{
  'edit:source': [input: FlowInput]
  'edit:ai': []
  'edit:output': [output: FlowOutput]
  'add:source': [sourceType: 'slack' | 'figma' | 'email']
  'add:output': [outputType: 'notion' | 'github' | 'linear']
}>()

// Show all inputs/outputs (not just active) for visual pipeline
const allInputs = computed(() => props.inputs)
const allOutputs = computed(() => props.outputs)
const hasFlow = computed(() => !!props.flow)

// Source type dropdown items
const sourceTypeItems = [[
  {
    label: 'Slack',
    icon: 'i-lucide-slack',
    onSelect: () => emit('add:source', 'slack'),
  },
  {
    label: 'Figma',
    icon: 'i-lucide-figma',
    onSelect: () => emit('add:source', 'figma'),
  },
  {
    label: 'Email',
    icon: 'i-lucide-mail',
    onSelect: () => emit('add:source', 'email'),
  },
]]

// Output type dropdown items
const outputTypeItems = [[
  {
    label: 'Notion',
    icon: 'i-simple-icons-notion',
    onSelect: () => emit('add:output', 'notion'),
  },
  {
    label: 'GitHub',
    icon: 'i-lucide-github',
    disabled: true,
    onSelect: () => emit('add:output', 'github'),
  },
  {
    label: 'Linear',
    icon: 'i-simple-icons-linear',
    disabled: true,
    onSelect: () => emit('add:output', 'linear'),
  },
]]

// Check if output is configured (has required config)
function isOutputConfigured(output: FlowOutput): boolean {
  if (output.outputType === 'notion') {
    const config = output.outputConfig as Record<string, any> | undefined
    const hasToken = !!(config?.notionToken || output.accountId)
    return !!(hasToken && config?.databaseId)
  }
  return output.active
}

// Source icon mapping (from FlowPipelineVisual)
function getSourceIcon(sourceType: string): string {
  const icons: Record<string, string> = {
    slack: 'i-lucide-slack',
    figma: 'i-lucide-figma',
    notion: 'i-simple-icons-notion',
    email: 'i-lucide-mail',
  }
  return icons[sourceType] || 'i-lucide-inbox'
}

function getSourceColor(sourceType: string): string {
  const colors: Record<string, string> = {
    slack: 'text-[#4A154B] dark:text-[#E01E5A]',
    figma: 'text-[#F24E1E]',
    notion: 'text-gray-900 dark:text-white',
    email: 'text-white',
  }
  return colors[sourceType] || 'text-gray-500'
}

function getSourceBg(sourceType: string): string {
  const colors: Record<string, string> = {
    slack: 'bg-[#4A154B]/10 dark:bg-[#E01E5A]/10',
    figma: 'bg-[#F24E1E]/10',
    notion: 'bg-gray-900/10 dark:bg-white/10',
    email: 'bg-white/10',
  }
  return colors[sourceType] || 'bg-gray-500/10'
}

function getOutputIcon(outputType: string): string {
  const icons: Record<string, string> = {
    notion: 'i-simple-icons-notion',
    github: 'i-lucide-github',
    linear: 'i-simple-icons-linear',
  }
  return icons[outputType] || 'i-lucide-send'
}

function getOutputColor(outputType: string): string {
  const colors: Record<string, string> = {
    notion: 'text-gray-900 dark:text-white',
    github: 'text-gray-900 dark:text-white',
    linear: 'text-[#5E6AD2]',
  }
  return colors[outputType] || 'text-gray-500'
}

function getOutputBg(outputType: string): string {
  const colors: Record<string, string> = {
    notion: 'bg-gray-900/10 dark:bg-white/10',
    github: 'bg-gray-900/10 dark:bg-white/10',
    linear: 'bg-[#5E6AD2]/10',
  }
  return colors[outputType] || 'bg-gray-500/10'
}

function getInputStatusLabel(input: FlowInput): string {
  if (input.sourceType === 'slack') {
    return (input.apiToken || input.accountId) ? 'Connected' : 'Not connected'
  }
  return input.active ? 'Active' : 'Inactive'
}

function isInputConnected(input: FlowInput): boolean {
  if (input.sourceType === 'slack') return !!(input.apiToken || input.accountId)
  return input.active
}

function getWorkspaceName(input: FlowInput): string | null {
  if (input.sourceType === 'slack') {
    return input.name || input.sourceMetadata?.slackWorkspaceName || null
  }
  return input.name || input.emailSlug || null
}

// AI is configured when enabled AND has either a per-flow key or the global server key
const isAiConfigured = computed(() => {
  return !!props.flow?.aiEnabled
})

// AI status helpers
function getAiStatusLabel(): string {
  if (!props.flow) return 'Not configured'
  if (!props.flow.aiEnabled) return 'Disabled'
  if (props.flow.anthropicApiKeyHint) return 'Flow API key'
  return 'Server API key'
}

// Preset info (label, icon, description)
const presetMap: Record<string, { label: string, icon: string, description: string }> = {
  default: { label: 'Balanced', icon: 'i-lucide-scale', description: 'General-purpose analysis' },
  technical: { label: 'Technical', icon: 'i-lucide-code', description: 'Implementation & architecture' },
  product: { label: 'Product', icon: 'i-lucide-lightbulb', description: 'User needs & business value' },
  design: { label: 'Design', icon: 'i-lucide-palette', description: 'Visual design & UX' },
  custom: { label: 'Custom', icon: 'i-lucide-pencil', description: 'Custom prompts' },
}

function getPresetKey(): string {
  if (!props.flow?.aiSummaryPrompt && !props.flow?.aiTaskPrompt) return 'default'
  const combined = `${props.flow.aiSummaryPrompt || ''} ${props.flow.aiTaskPrompt || ''}`
  if (/technical|implementation/i.test(combined)) return 'technical'
  if (/user needs|business value|product/i.test(combined)) return 'product'
  if (/visual design|user experience/i.test(combined)) return 'design'
  return 'custom'
}

const presetInfo = computed(() => presetMap[getPresetKey()] ?? presetMap.default!)

// Personality info (label, icon, description)
const personalityMap: Record<string, { label: string, icon: string, description: string }> = {
  professional: { label: 'Professional', icon: '💼', description: 'Formal, clear, minimal' },
  friendly: { label: 'Friendly', icon: '👋', description: 'Warm, encouraging' },
  concise: { label: 'Concise', icon: '⚡', description: 'Ultra-brief' },
}

const personalityInfo = computed(() => {
  const p = props.flow?.replyPersonality
  if (!p) return personalityMap.professional!
  if (p.startsWith('custom:')) return { label: 'Custom', icon: '✏️', description: p.replace(/^custom:/, '').slice(0, 60) + (p.length > 67 ? '...' : '') }
  return personalityMap[p] ?? { label: p, icon: '🤖', description: '' }
})

// Missing items helpers
function getInputMissing(input: FlowInput): string[] {
  const missing: string[] = []
  if (input.sourceType === 'slack' && !input.apiToken && !input.accountId) missing.push('Connect Slack workspace')
  if (input.sourceType === 'email' && !input.emailSlug) missing.push('Set email address')
  if (input.sourceType === 'figma' && !input.emailAddress) missing.push('Set Figma email webhook')
  return missing
}

function getAiMissing(): string[] {
  const missing: string[] = []
  if (!props.flow?.aiEnabled) missing.push('Enable AI analysis')
  return missing
}

function getOutputMissing(output: FlowOutput): string[] {
  const missing: string[] = []
  if (output.outputType === 'notion') {
    const config = output.outputConfig as Record<string, any> | undefined
    if (!config?.notionToken && !output.accountId) missing.push('Add Notion token')
    if (!config?.databaseId) missing.push('Select database')
  }
  return missing
}

function getDomainColor(domain: string): string {
  const colors: Record<string, string> = {
    design: 'text-purple-500',
    frontend: 'text-blue-500',
    backend: 'text-green-500',
    product: 'text-orange-500',
    infrastructure: 'text-amber-700',
    docs: 'text-cyan-500',
  }
  return colors[domain.toLowerCase()] || 'text-gray-400'
}

function getDomainDotColor(domain: string): string {
  const colors: Record<string, string> = {
    design: 'bg-purple-500',
    frontend: 'bg-blue-500',
    backend: 'bg-green-500',
    product: 'bg-orange-500',
    infrastructure: 'bg-amber-700',
    docs: 'bg-cyan-500',
  }
  return colors[domain.toLowerCase()] || 'bg-gray-400'
}
</script>

<template>
  <div class="flex items-center py-1">
    <!-- Sources -->
    <div class="flex items-center gap-1">
      <!-- Add source -->
      <UDropdownMenu :items="sourceTypeItems">
        <button class="group/add h-10 rounded-xl bg-gray-500/10 opacity-50 flex items-center justify-center transition-all hover:opacity-100 hover:scale-105 cursor-pointer w-10 hover:w-auto hover:px-3 hover:gap-1.5">
          <UIcon name="i-lucide-plus" class="w-5 h-5 text-gray-400 group-hover/add:hidden" />
          <span class="hidden group-hover/add:inline text-xs font-medium text-gray-500 whitespace-nowrap">add input</span>
        </button>
      </UDropdownMenu>

      <!-- Existing source icons -->
      <UPopover
        v-for="input in allInputs"
        :key="input.id"
        mode="hover"
        arrow
        :ui="{ content: 'w-64' }"
      >
        <button
          class="w-10 h-10 rounded-xl flex items-center justify-center transition-all hover:scale-110 cursor-pointer"
          :class="isInputConnected(input) ? getSourceBg(input.sourceType) : 'bg-gray-500/10 opacity-50'"
          @click="emit('edit:source', input)"
        >
          <UIcon
            :name="getSourceIcon(input.sourceType)"
            :class="['w-5 h-5', isInputConnected(input) ? getSourceColor(input.sourceType) : 'text-gray-400']"
          />
        </button>

        <template #content>
          <div class="p-3 space-y-2">
            <div class="flex items-center justify-between">
              <span class="font-semibold text-sm">{{ input.sourceType.charAt(0).toUpperCase() + input.sourceType.slice(1) }}</span>
              <div
                class="w-2 h-2 rounded-full flex-shrink-0"
                :class="isInputConnected(input) ? 'bg-green-500' : 'bg-red-500'"
              />
            </div>
            <p v-if="getWorkspaceName(input)" class="text-xs text-muted-foreground">
              {{ getWorkspaceName(input) }}
            </p>
            <div v-if="getInputMissing(input).length" class="space-y-1">
              <p v-for="item in getInputMissing(input)" :key="item" class="text-xs text-red-500 flex items-center gap-1">
                <UIcon name="i-lucide-circle-alert" class="w-3 h-3 flex-shrink-0" />
                {{ item }}
              </p>
            </div>
            <div class="flex gap-2 pt-1">
              <UButton size="xs" variant="outline" color="neutral" @click="emit('edit:source', input)">
                Edit
              </UButton>
            </div>
          </div>
        </template>
      </UPopover>
    </div>

    <!-- AI (fixed center) -->
    <div class="flex items-center gap-3 flex-shrink-0 px-3">
    <UIcon name="i-lucide-arrow-right" class="w-4 h-4 text-gray-400 dark:text-gray-600 flex-shrink-0" />

    <UPopover mode="hover" arrow :ui="{ content: 'w-72' }">
        <button
          class="w-10 h-10 rounded-xl flex items-center justify-center transition-all hover:scale-110 cursor-pointer"
          :class="isAiConfigured ? 'bg-violet-500/10' : 'bg-gray-500/10 opacity-50'"
          @click="emit('edit:ai')"
        >
          <span v-if="flow?.personalityIcon" class="text-lg leading-none">{{ flow.personalityIcon }}</span>
          <UIcon
            v-else
            name="i-lucide-brain"
            :class="[
              'w-5 h-5',
              isAiConfigured ? 'text-violet-500' : 'text-gray-400'
            ]"
          />
        </button>

      <template #content>
        <div class="p-3 space-y-3">
          <div class="flex items-center justify-between">
            <span class="font-semibold text-sm">AI Analysis</span>
            <div
              class="w-2 h-2 rounded-full flex-shrink-0"
              :class="isAiConfigured ? 'bg-green-500' : 'bg-red-500'"
            />
          </div>
          <div v-if="getAiMissing().length" class="space-y-1">
            <p v-for="item in getAiMissing()" :key="item" class="text-xs text-red-500 flex items-center gap-1">
              <UIcon name="i-lucide-circle-alert" class="w-3 h-3 flex-shrink-0" />
              {{ item }}
            </p>
          </div>
          <div v-else-if="flow" class="space-y-2.5">
            <!-- Analysis Focus -->
            <div class="flex items-center gap-2">
              <UIcon :name="presetInfo.icon" class="w-3.5 h-3.5 text-violet-500 flex-shrink-0" />
              <div class="min-w-0">
                <p class="text-xs font-medium">{{ presetInfo.label }}</p>
                <p class="text-[11px] text-muted-foreground truncate">{{ presetInfo.description }}</p>
              </div>
            </div>
            <!-- Personality -->
            <div class="flex items-center gap-2">
              <span class="text-sm leading-none flex-shrink-0 w-3.5 text-center">{{ personalityInfo.icon }}</span>
              <div class="min-w-0">
                <p class="text-xs font-medium">{{ personalityInfo.label }}</p>
                <p class="text-[11px] text-muted-foreground truncate">{{ personalityInfo.description }}</p>
              </div>
            </div>
            <!-- Domains -->
            <div v-if="flow.availableDomains?.length">
              <div class="flex flex-wrap gap-1">
                <span
                  v-for="domain in flow.availableDomains"
                  :key="domain"
                  class="inline-flex items-center gap-1 text-[11px] px-1.5 py-0.5 rounded-full bg-gray-500/10"
                >
                  <span class="w-1.5 h-1.5 rounded-full" :class="getDomainDotColor(domain)" />
                  {{ domain }}
                </span>
              </div>
            </div>
          </div>
          <div class="pt-0.5">
            <UButton size="xs" variant="outline" color="neutral" @click="emit('edit:ai')">
              Edit
            </UButton>
          </div>
        </div>
      </template>
    </UPopover>

    <UIcon name="i-lucide-arrow-right" class="w-4 h-4 text-gray-400 dark:text-gray-600 flex-shrink-0" />
    </div>

    <!-- Outputs -->
    <div class="flex items-center gap-1">
      <!-- Existing output icons -->
      <UPopover
        v-for="output in allOutputs"
        :key="output.id"
        mode="hover"
        arrow
        :ui="{ content: 'w-64' }"
      >
        <button
          class="w-10 h-10 rounded-xl flex items-center justify-center transition-all hover:scale-110 cursor-pointer relative"
          :class="isOutputConfigured(output) ? getOutputBg(output.outputType) : 'bg-gray-500/10 opacity-50'"
          @click="emit('edit:output', output)"
        >
          <UIcon
            :name="getOutputIcon(output.outputType)"
            :class="['w-5 h-5', isOutputConfigured(output) ? getOutputColor(output.outputType) : 'text-gray-400']"
          />
          <!-- Domain dots (hidden when all domains selected = no filter) -->
          <div
            v-if="output.domainFilter?.length && output.domainFilter.length < 6"
            class="absolute -bottom-0.5 flex gap-0.5"
          >
            <span
              v-for="domain in output.domainFilter.slice(0, 3)"
              :key="domain"
              :class="['w-1 h-1 rounded-full', getDomainDotColor(domain)]"
            />
          </div>
        </button>

        <template #content>
          <div class="p-3 space-y-2">
            <div class="flex items-center justify-between">
              <span class="font-semibold text-sm">{{ output.outputType.charAt(0).toUpperCase() + output.outputType.slice(1) }}</span>
              <div class="flex items-center gap-1.5">
                <UBadge v-if="output.isDefault" size="xs" color="primary" variant="subtle">Default</UBadge>
                <div
                  class="w-2 h-2 rounded-full flex-shrink-0"
                  :class="isOutputConfigured(output) ? 'bg-green-500' : 'bg-red-500'"
                />
              </div>
            </div>
            <div v-if="getOutputMissing(output).length" class="space-y-1">
              <p v-for="item in getOutputMissing(output)" :key="item" class="text-xs text-red-500 flex items-center gap-1">
                <UIcon name="i-lucide-circle-alert" class="w-3 h-3 flex-shrink-0" />
                {{ item }}
              </p>
            </div>
            <div v-else class="space-y-1 text-xs text-muted-foreground">
              <p>Type: {{ output.outputType }}</p>
              <p v-if="output.domainFilter?.length">
                Domains: {{ output.domainFilter.join(', ') }}
              </p>
              <p v-else>All domains</p>
            </div>
            <div class="flex gap-2 pt-1">
              <UButton size="xs" variant="outline" color="neutral" @click="emit('edit:output', output)">
                Edit
              </UButton>
            </div>
          </div>
        </template>
      </UPopover>

      <!-- Add output -->
      <UDropdownMenu :items="outputTypeItems">
        <button class="group/add h-10 rounded-xl bg-gray-500/10 opacity-50 flex items-center justify-center transition-all hover:opacity-100 hover:scale-105 cursor-pointer w-10 hover:w-auto hover:px-3 hover:gap-1.5">
          <UIcon name="i-lucide-plus" class="w-5 h-5 text-gray-400 group-hover/add:hidden" />
          <span class="hidden group-hover/add:inline text-xs font-medium text-gray-500 whitespace-nowrap">add output</span>
        </button>
      </UDropdownMenu>
    </div>
  </div>
</template>
