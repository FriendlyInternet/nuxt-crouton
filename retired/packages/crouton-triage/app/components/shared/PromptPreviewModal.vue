<template>
  <UModal v-model:open="isOpen">
    <template #content="{ close }">
      <div class="p-6 max-h-[85vh] overflow-y-auto">
        <!-- Header -->
        <div class="flex items-center justify-between mb-6">
          <h3 class="text-lg font-semibold">Prompt Preview</h3>
          <UButton
            color="neutral"
            variant="ghost"
            icon="i-lucide-x"
            @click="close"
            size="sm"
          />
        </div>

        <!-- Info Banner -->
        <div class="mb-6 p-4 bg-primary/10 rounded-lg border border-primary/20">
          <p class="text-sm text-primary-600 dark:text-primary-400">
            This is what will be sent to Claude when processing discussions. Custom prompts are highlighted.
          </p>
        </div>

        <!-- Summary Prompt Section -->
        <div class="mb-6">
          <div class="flex items-center justify-between mb-3">
            <h4 class="text-sm font-semibold flex items-center gap-2">
              <UIcon name="i-lucide-sparkles" class="w-4 h-4 text-primary" />
              Summary Prompt
            </h4>
            <div class="flex gap-3 text-xs text-muted-foreground">
              <span>{{ preview.summaryCharCount }} characters</span>
              <span>~{{ preview.summaryTokenEstimate }} tokens</span>
            </div>
          </div>
          <div class="p-4 bg-gray-50 dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-800">
            <pre class="text-xs font-mono whitespace-pre-wrap leading-relaxed" v-html="highlightCustomPrompt(preview.summaryPrompt, customSummaryPrompt)"></pre>
          </div>
        </div>

        <USeparator class="my-6" />

        <!-- Task Detection Prompt Section -->
        <div class="mb-6">
          <div class="flex items-center justify-between mb-3">
            <h4 class="text-sm font-semibold flex items-center gap-2">
              <UIcon name="i-lucide-list-checks" class="w-4 h-4 text-primary" />
              Task Detection Prompt
            </h4>
            <div class="flex gap-3 text-xs text-muted-foreground">
              <span>{{ preview.taskCharCount }} characters</span>
              <span>~{{ preview.taskTokenEstimate }} tokens</span>
            </div>
          </div>
          <div class="p-4 bg-gray-50 dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-800">
            <pre class="text-xs font-mono whitespace-pre-wrap leading-relaxed" v-html="highlightCustomPrompt(preview.taskPrompt, customTaskPrompt)"></pre>
          </div>
        </div>

        <USeparator class="my-6" />

        <!-- Total Stats -->
        <div class="flex items-center justify-between p-4 bg-muted/50 rounded-lg">
          <span class="text-sm font-medium">Total</span>
          <div class="flex gap-4 text-sm">
            <span>{{ preview.summaryCharCount + preview.taskCharCount }} characters</span>
            <span>~{{ preview.summaryTokenEstimate + preview.taskTokenEstimate }} tokens</span>
          </div>
        </div>

        <!-- Footer -->
        <div class="flex justify-end gap-2 mt-6">
          <UButton color="neutral" variant="ghost" @click="close">
            Close
          </UButton>
        </div>
      </div>
    </template>
  </UModal>
</template>

<script setup lang="ts">
// @ts-expect-error - layer types resolved at app level
import type { PromptPreview } from '#layers/triage/app/composables/useTriagePromptPreview'

interface Props {
  modelValue: boolean
  preview: PromptPreview
  customSummaryPrompt?: string
  customTaskPrompt?: string
}

const props = defineProps<Props>()
const emit = defineEmits<{
  'update:modelValue': [value: boolean]
}>()

const isOpen = computed({
  get: () => props.modelValue,
  set: (value) => emit('update:modelValue', value)
})

/**
 * Highlight custom prompt text in the full prompt
 * Returns HTML with highlighted sections
 */
const highlightCustomPrompt = (fullPrompt: string, customPrompt?: string): string => {
  if (!customPrompt || !customPrompt.trim()) {
    return escapeHtml(fullPrompt)
  }

  // Escape HTML first
  const escapedPrompt = escapeHtml(fullPrompt)
  const escapedCustom = escapeHtml(customPrompt.trim())

  // Highlight the custom prompt text
  const highlighted = escapedPrompt.replace(
    escapedCustom,
    `<span class="bg-primary/20 text-primary-700 dark:text-primary-300 px-1 rounded">${escapedCustom}</span>`
  )

  return highlighted
}

/**
 * Escape HTML to prevent XSS
 */
const escapeHtml = (text: string): string => {
  const div = document.createElement('div')
  div.textContent = text
  return div.innerHTML
}
</script>
