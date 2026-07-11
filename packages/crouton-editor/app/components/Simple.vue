<script setup lang="ts">
/**
 * CroutonEditorSimple
 *
 * A simple rich text editor following the Nuxt UI Editor pattern.
 * Uses UEditor + UEditorToolbar with sensible defaults.
 *
 * Based on: https://github.com/nuxt-ui-templates/editor
 */
import { useEventListener } from '@vueuse/core'
import type { EditorToolbarItem } from '@nuxt/ui'
import type { Editor } from '@tiptap/vue-3'
import {
  undoRedoGroup,
  blockTypesGroup,
  marksGroup,
  linkGroup,
  bubbleTurnIntoFull,
  marksGroup as bubbleMarksFull
} from '../utils/toolbarPresets'

/**
 * Translation context for AI-powered translation suggestions
 */
interface TranslationContext {
  sourceText: string
  sourceLanguage: string
  targetLanguage: string
  fieldType?: string
  existingTranslations?: Record<string, string>
  customInstructions?: string
}

interface Props {
  modelValue?: string | null
  placeholder?: string
  contentType?: 'html' | 'markdown' | 'json'
  editable?: boolean
  autofocus?: boolean | 'start' | 'end' | 'all' | number
  showToolbar?: boolean
  showBubbleToolbar?: boolean
  extensions?: any[]
  /** Enable AI translation suggestions (requires @fyit/crouton-ai) */
  enableTranslationAI?: boolean
  /** Translation context for AI suggestions */
  translationContext?: TranslationContext
  /** Callback when translation is accepted */
  onTranslationAccept?: (text: string) => void
  /** Enable image upload in toolbar (requires blob storage) */
  enableImageUpload?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  contentType: 'html',
  editable: true,
  showToolbar: true,
  showBubbleToolbar: true,
  enableTranslationAI: false,
  enableImageUpload: false
})

const emit = defineEmits<{
  'update:modelValue': [value: string]
  'create': [{ editor: Editor }]
  'update': [{ editor: Editor }]
  'translationAccept': [text: string]
}>()

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

// Track the editor instance for translation commands.
// shallowRef (not ref) — tiptap's Editor is a class holding internal reactive
// refs; a deep ref() unwraps them and corrupts the Editor type (TS2345).
const editorInstance = shallowRef<Editor | null>(null)
const isTranslating = ref(false)
const isUploadingImage = ref(false)

// Build extensions list with optional TranslationAI
const allExtensions = computed(() => {
  const ext = [...(props.extensions || [])]

  // TranslationAI extension is added dynamically when enabled
  // The extension itself is provided by the parent component or via props.extensions
  // We don't import it directly to avoid hard dependency on crouton-ai

  return ext
})

// Handle translation trigger from toolbar button
async function triggerTranslation() {
  if (!editorInstance.value || !props.translationContext) return

  // Check if editor has TranslationAI extension
  if ((editorInstance.value.commands as any).triggerTranslationSuggestion) {
    (editorInstance.value.commands as any).triggerTranslationSuggestion()
  } else {
    // Fallback: Call API directly for editors without the extension
    await translateSelectedText()
  }
}

// Direct translation (fallback when extension not available)
async function translateSelectedText() {
  if (!editorInstance.value || !props.translationContext) return

  const { from, to } = editorInstance.value.state.selection
  const selectedText = editorInstance.value.state.doc.textBetween(from, to)

  if (!selectedText) return

  isTranslating.value = true

  try {
    const result = await $fetch<{ text: string }>('/api/ai/translate', {
      method: 'POST',
      body: {
        sourceText: selectedText,
        sourceLanguage: props.translationContext.sourceLanguage || 'en',
        targetLanguage: props.translationContext.targetLanguage,
        fieldType: props.translationContext.fieldType,
        existingTranslations: props.translationContext.existingTranslations,
        customInstructions: props.translationContext.customInstructions
      }
    })

    if (result?.text) {
      // Replace selection with translated text
      editorInstance.value
        .chain()
        .focus()
        .deleteRange({ from, to })
        .insertContent(result.text)
        .run()

      emit('translationAccept', result.text)
      props.onTranslationAccept?.(result.text)
    }
  } catch (err) {
    console.error('Translation error:', err)
  } finally {
    isTranslating.value = false
  }
}

/**
 * Upload a single image file and insert it into the given editor.
 * Centralizes the upload + insert logic shared by toolbar button, paste, and drop handlers.
 */
async function uploadAndInsertImage(editor: Editor, file: File) {
  isUploadingImage.value = true
  try {
    const formData = new FormData()
    formData.append('file', file)

    const result = await $fetch<{ pathname: string }>('/api/upload-image', {
      method: 'POST',
      body: formData
    })

    editor
      .chain()
      .focus()
      .setImage({ src: `/images/${result.pathname}`, alt: file.name })
      .run()
  } catch (err) {
    console.error('Image upload failed:', err)
  } finally {
    isUploadingImage.value = false
  }
}

// Image upload handler — opens file picker
async function handleImageUpload() {
  if (!editorInstance.value) return

  const input = document.createElement('input')
  input.type = 'file'
  input.accept = 'image/*'
  input.onchange = async () => {
    const file = input.files?.[0]
    if (!file || !editorInstance.value) return
    await uploadAndInsertImage(editorInstance.value, file)
  }
  input.click()
}

// UEditor declares no `create` event (only update:modelValue) and its internal
// useEditor options clobber a consumer-passed onCreate — @create below never
// fires. Capture the instance from UEditor's exposed `editor` ref instead.
const ueditorRef = ref<{ editor?: unknown } | null>(null)
watch(() => ueditorRef.value?.editor, (ed) => {
  // Same runtime object as our @tiptap/vue-3 Editor — cast across @nuxt/ui's
  // duplicate tiptap type identity (vue-tsc sees them as different types).
  const editor = ed as Editor | undefined
  if (editor && editor !== editorInstance.value) handleEditorCreate({ editor })
})

// Handle paste/drop image upload
function handleEditorCreate(event: { editor: Editor }) {
  editorInstance.value = event.editor

  if (props.enableImageUpload) {
    const editorDom = event.editor.view.dom

    // useEventListener auto-removes the handler on component unmount
    useEventListener(editorDom, 'paste', async (e: ClipboardEvent) => {
      const items = e.clipboardData?.items
      if (!items) return

      for (const item of items) {
        if (item.type.startsWith('image/')) {
          e.preventDefault()
          const file = item.getAsFile()
          if (!file) continue
          await uploadAndInsertImage(event.editor, file)
          break
        }
      }
    })

    // useEventListener auto-removes the handler on component unmount
    useEventListener(editorDom, 'drop', async (e: DragEvent) => {
      const files = e.dataTransfer?.files
      if (!files?.length) return

      const imageFile = Array.from(files).find(f => f.type.startsWith('image/'))
      if (!imageFile) return

      e.preventDefault()
      await uploadAndInsertImage(event.editor, imageFile)
    })
  }

  emit('create', event)
}

// Base toolbar items (always visible at top) — composed from shared presets
const baseToolbarItems: EditorToolbarItem[][] = [
  undoRedoGroup,
  blockTypesGroup,
  marksGroup,
  linkGroup
]

// Computed toolbar items with optional image upload and AI translation buttons
const toolbarItems = computed<EditorToolbarItem[][]>(() => {
  const items = [...baseToolbarItems]

  // Add image upload button
  if (props.enableImageUpload) {
    items.push([
      {
        icon: 'i-lucide-image-plus',
        tooltip: { text: 'Insert Image' },
        onClick: handleImageUpload
      } as EditorToolbarItem
    ])
  }

  // Add AI translation button when enabled and context is provided
  if (props.enableTranslationAI && props.translationContext) {
    items.push([
      {
        icon: 'i-lucide-sparkles',
        tooltip: { text: 'Translate selection (⌘J)' },
        onClick: triggerTranslation
      } as EditorToolbarItem
    ])
  }

  return items
})

// Bubble toolbar items (appears on text selection) — composed from shared presets
const bubbleToolbarItems: EditorToolbarItem[][] = [
  bubbleTurnIntoFull,
  bubbleMarksFull,
  linkGroup
]
</script>

<template>
  <UEditor
    ref="ueditorRef"
    v-slot="{ editor }"
    v-model="model"
    :content-type="contentType"
    :placeholder="placeholder"
    :editable="editable"
    :autofocus="autofocus"
    :extensions="allExtensions"
    class="flex flex-col h-full"
    :ui="{
      root: 'h-full flex flex-col',
      content: 'flex-1 overflow-auto prose prose-sm dark:prose-invert max-w-none p-4'
    }"
    @create="handleEditorCreate as any"
    @update="($emit as any)('update', $event)"
  >
    <!-- Fixed toolbar at top -->
    <UEditorToolbar
      v-if="editor && showToolbar"
      :editor="editor"
      :items="toolbarItems"
      class="border-b border-default px-2 py-1.5 flex-shrink-0"
    >
      <!-- Loading indicator when translating or uploading -->
      <template v-if="isTranslating || isUploadingImage" #append>
        <div class="flex items-center gap-2 text-xs text-gray-500 ml-2">
          <UIcon name="i-lucide-loader-2" class="animate-spin" />
          <span>{{ isTranslating ? 'Translating...' : 'Uploading image...' }}</span>
        </div>
      </template>
    </UEditorToolbar>

    <!-- Bubble toolbar on text selection -->
    <UEditorToolbar
      v-if="editor && showBubbleToolbar"
      :editor="editor"
      :items="bubbleToolbarItems"
      layout="bubble"
      :should-show="({ view, state }: any) => {
        if (!view.docView) return false
        const { selection } = state
        return view.hasFocus() && !selection.empty
      }"
    />
  </UEditor>
</template>
