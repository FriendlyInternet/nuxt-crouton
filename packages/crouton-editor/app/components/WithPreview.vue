<template>
  <div class="w-full">
    <UTabs v-model="activeTab" :items="tabItems" :ui="{ indicator: 'bg-primary/10', trigger: 'data-[state=active]:text-primary' }" class="w-full">
      <template #content="{ item }">
        <!-- Editor Tab -->
        <div v-if="item.value === 'editor'" class="pt-4">
          <div class="border border-default rounded-lg overflow-hidden">
            <!-- Variable chips (quick insert) -->
            <div
              v-if="showVariableChips && variables?.length"
              class="flex flex-wrap gap-1 p-2 border-b border-default bg-muted/20"
            >
              <span class="text-xs text-muted mr-1 self-center">Insert:</span>
              <UButton
                v-for="variable in variables.slice(0, 6)"
                :key="variable.name"
                size="xs"
                color="neutral"
                variant="soft"
                :icon="variable.icon || 'i-lucide-braces'"
                @click="insertVariable(variable.name)"
              >
                {{ variable.label }}
              </UButton>
              <UDropdownMenu
                v-if="variables.length > 6"
                :items="moreVariablesItems"
              >
                <UButton
                  size="xs"
                  color="neutral"
                  variant="soft"
                  icon="i-lucide-more-horizontal"
                >
                  More
                </UButton>
              </UDropdownMenu>
            </div>

            <!-- Editor -->
            <UEditor
              ref="editorRef"
              v-model="model"
              :content-type="contentType"
              :placeholder="placeholder"
              :editable="editable"
              :extensions="extensions"
              class="min-h-48"
              @create="handleEditorCreate as any"
            >
              <template #default="{ editor }">
                <!-- Toolbar for formatting -->
                <UEditorToolbar
                  :editor="editor"
                  :items="toolbarItems"
                  class="p-2 border-b border-default flex-nowrap overflow-x-auto overscroll-x-contain touch-pan-x"
                  :ui="{ group: 'shrink-0' }"
                />

                <slot :editor="editor" />
              </template>
            </UEditor>
          </div>
        </div>

        <!-- Preview Tab -->
        <div v-else-if="item.value === 'preview'" class="pt-4">
          <CroutonEditorPreview
            :content="model"
            :title="previewTitle"
            :variables="variables"
            :values="previewValues"
            mode="panel"
            :expandable="true"
            content-class="min-h-48"
          />
        </div>
      </template>
    </UTabs>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import type { Editor } from '@tiptap/vue-3'
import type { EditorToolbarItem } from '@nuxt/ui'
import type { EditorVariable } from '../types/editor'
import CroutonEditorPreview from './Preview.vue'
import { marksMinimal, linkGroup, listsFlat, undoRedoGroup } from '../utils/toolbarPresets'

// Slim toolbar for the email-template editor — composed from shared presets.
const toolbarItems: EditorToolbarItem[][] = [
  marksMinimal,
  linkGroup,
  listsFlat,
  undoRedoGroup
]

interface Props {
  /** Content (v-model) */
  modelValue?: string | null
  /** Variables for insertion menu */
  variables?: EditorVariable[]
  /** Values for preview interpolation (overrides sample values) */
  previewValues?: Record<string, string>
  /** Title for preview panel */
  previewTitle?: string
  /** Content type: html, markdown, json */
  contentType?: 'html' | 'markdown' | 'json'
  /** Placeholder text */
  placeholder?: string
  /** Enable/disable editing */
  editable?: boolean
  /** Show quick-insert variable chips above editor */
  showVariableChips?: boolean
  /** Additional TipTap extensions */
  extensions?: any[]
}

const props = withDefaults(defineProps<Props>(), {
  contentType: 'html',
  editable: true,
  showVariableChips: true,
  previewTitle: 'Preview'
})

const emit = defineEmits<{
  'update:modelValue': [value: string]
}>()

// v-model — parse JSON strings for UEditor (expects object for json content-type)
const model = computed({
  get: () => {
    if (props.contentType === 'json' && typeof props.modelValue === 'string' && props.modelValue) {
      try {
        return JSON.parse(props.modelValue)
      } catch {
        return props.modelValue
      }
    }
    return props.modelValue || ''
  },
  set: (value) => {
    if (props.contentType === 'json' && typeof value === 'object') {
      emit('update:modelValue', JSON.stringify(value))
    } else {
      emit('update:modelValue', value)
    }
  }
})

// Tab state
const activeTab = ref('editor')
const tabItems = [
  { label: 'Editor', value: 'editor', icon: 'i-lucide-edit-3' },
  { label: 'Preview', value: 'preview', icon: 'i-lucide-eye' }
]

// Editor instance reference
const editorInstance = ref<Editor | null>(null)

function handleEditorCreate({ editor }: { editor: Editor }) {
  editorInstance.value = editor
}

/**
 * Insert a variable at cursor position
 */
function insertVariable(name: string) {
  if (!editorInstance.value) return

  const variableText = `{{${name}}}`

  editorInstance.value
    .chain()
    .focus()
    .insertContent(variableText)
    .run()
}

/**
 * Dropdown items for "more variables" button
 */
const moreVariablesItems = computed(() => {
  if (!props.variables?.length) return []

  return props.variables.slice(6).map(v => ({
    label: v.label,
    icon: v.icon || 'i-lucide-braces',
    onSelect: () => insertVariable(v.name)
  }))
})
</script>
