<script setup lang="ts">
/**
 * CroutonEditorBlocks
 *
 * A block-based editor built on UEditor with slash command support.
 * Supports custom NodeView blocks with property panel editing.
 * Supports real-time collaboration via Yjs when yxmlFragment is provided.
 *
 * Usage:
 * <CroutonEditorBlocks
 *   v-model="content"
 *   :extensions="[MyBlockExtension]"
 *   :suggestion-items="blockItems"
 *   content-type="json"
 * />
 *
 * With collaboration:
 * <CroutonEditorBlocks
 *   :yxml-fragment="collabFragment"
 *   :extensions="[MyBlockExtension]"
 *   content-type="json"
 * />
 */
import { ref, computed, onMounted, onUnmounted, watch, markRaw } from 'vue'
import type { Editor } from '@tiptap/vue-3'
import type { EditorSuggestionMenuItem, EditorToolbarItem } from '@nuxt/ui'
import type * as Y from 'yjs'
import {
  undoRedoGroup,
  blockTypesGroup,
  marksGroup,
  linkGroup,
  bubbleTurnIntoSlim,
  bubbleMarksSlim
} from '../utils/toolbarPresets'

export interface BlockSuggestionItem {
  /** Block type name (e.g., 'heroBlock') */
  type: string
  /** Display label in menu */
  label: string
  /** Description shown in menu */
  description?: string
  /** Icon name (e.g., 'i-lucide-layout-template') */
  icon?: string
  /** Category for grouping */
  category?: string
  /** TipTap command name (e.g., 'insertHeroBlock') */
  command: string
}

/** TipTap JSON document structure */
type TipTapDoc = { type: 'doc'; content: unknown[] }

interface Props {
  modelValue?: string | TipTapDoc | null
  placeholder?: string
  contentType?: 'html' | 'markdown' | 'json'
  editable?: boolean
  autofocus?: boolean | 'start' | 'end' | 'all' | number
  /** Custom TipTap extensions for blocks */
  extensions?: any[]
  /** Show the default toolbar */
  showToolbar?: boolean
  /** Show bubble toolbar on selection */
  showBubbleToolbar?: boolean
  /** Block items for slash command menu */
  suggestionItems?: BlockSuggestionItem[]
  /**
   * Y.XmlFragment for real-time collaboration.
   * When provided, editor syncs to Yjs instead of using modelValue.
   * Content is stored in the Y.XmlFragment and synced via WebSocket.
   */
  yxmlFragment?: Y.XmlFragment
  /**
   * Collab provider for cursor awareness (optional).
   * Used by CollaborationCursor extension to show other users' cursors.
   */
  collabProvider?: { awareness: any }
  /**
   * User info for collaboration cursors.
   */
  collabUser?: { name: string; color?: string }
}

const props = withDefaults(defineProps<Props>(), {
  contentType: 'json',
  editable: true,
  showToolbar: true,
  showBubbleToolbar: true,
  suggestionItems: () => []
})

// Dynamically load Collaboration extension if yxmlFragment is provided
const collabExtensions = ref<any[]>([])
const collabReady = ref(false)
const collabLoading = ref(false)
const lastFragmentId = ref<string | null>(null)

// Key to force editor recreation when collab mode changes
// This ensures the Collaboration extension is properly initialized
const editorKey = computed(() => {
  const fragmentId = props.yxmlFragment ? 'collab' : 'local'
  const readyState = collabReady.value ? 'ready' : 'loading'
  return `${fragmentId}-${readyState}`
})

// Load Collaboration extension when yxmlFragment is provided
// Guard against multiple simultaneous loads (can happen with i18n tabs)
watch(() => props.yxmlFragment, async (fragment) => {
  if (fragment) {
    // Generate a unique ID for this fragment to detect duplicate loads
    const fragmentId = (fragment as any)._item?.id?.toString() || String(Date.now())

    // Skip if we're already loading this fragment or have already loaded it
    if (collabLoading.value || lastFragmentId.value === fragmentId) {
      return
    }

    collabLoading.value = true
    collabReady.value = false
    lastFragmentId.value = fragmentId

    try {
      // Dynamically import TipTap Collaboration extension
      const { Collaboration } = await import('@tiptap/extension-collaboration')
      const extensions: any[] = [
        Collaboration.configure({
          fragment
        })
      ]

      // Note: CollaborationCursor requires y-websocket provider format with awareness.setLocalStateField
      // Our custom WebSocket connection doesn't provide this, so cursor sync is disabled for now
      // Content sync still works via the Collaboration extension above

      collabExtensions.value = markRaw(extensions)
      collabReady.value = true
    } catch (e) {
      // TipTap collab extensions are provided by @fyit/crouton-collab package.
      // If that package isn't installed, this is expected and collab is simply disabled.
      console.warn('[CroutonEditorBlocks] Collaboration disabled - @fyit/crouton-collab not installed')
      if (import.meta.dev) {
        console.debug('[CroutonEditorBlocks] Dynamic import error:', e)
      }
      collabReady.value = true // Still mark ready so editor can render
    } finally {
      collabLoading.value = false
    }
  } else {
    collabExtensions.value = []
    collabReady.value = true
    lastFragmentId.value = null
  }
}, { immediate: true })

// Combine base extensions with collab extensions
const allExtensions = computed(() => {
  const base = props.extensions || []
  return [...base, ...collabExtensions.value]
})

// In collab mode, we don't use v-model - content syncs via Yjs
const isCollabMode = computed(() => !!props.yxmlFragment)

// StarterKit options - disable undoRedo when collaboration is enabled
// TipTap's Collaboration extension has built-in history via y-prosemirror
// that conflicts with the standard undo-redo extension
const starterKitOptions = computed(() => {
  if (isCollabMode.value) {
    return { undoRedo: false }
  }
  return {}
})

const emit = defineEmits<{
  'update:modelValue': [value: string | TipTapDoc]
  'create': [{ editor: Editor }]
  'update': [{ editor: Editor }]
  'block:select': [{ node: any; pos: number } | null]
  'block:edit': [{ node: any; pos: number }]
}>()

// Empty TipTap document - must have at least one paragraph node
const emptyDoc: TipTapDoc = { type: 'doc', content: [{ type: 'paragraph' }] }

// Two-way binding for editor content
// Returns appropriate empty value based on content type
const content = computed({
  get: () => {
    if (props.modelValue) {
      // Parse JSON strings — UEditor expects objects for json content-type
      let val = props.modelValue
      if (props.contentType === 'json' && typeof val === 'string') {
        try {
          val = JSON.parse(val)
        } catch {
          return emptyDoc
        }
      }
      // Ensure JSON docs have at least one node (TipTap requirement)
      if (props.contentType === 'json' && typeof val === 'object') {
        const doc = val as TipTapDoc
        if (!doc.content || doc.content.length === 0) {
          return emptyDoc
        }
      }
      return val
    }
    // Return appropriate empty value for content type
    if (props.contentType === 'json') {
      return emptyDoc
    }
    return '' // For html and markdown
  },
  set: (value) => {
    if (props.contentType === 'json' && typeof value === 'object') {
      emit('update:modelValue', JSON.stringify(value))
    } else {
      emit('update:modelValue', value)
    }
  }
})

// Editor instance (populated via @create event)
const editorInstance = ref<Editor | null>(null)

// Unique ID for this editor instance (used to scope block-edit-request events)
const editorId = `crouton-editor-${Math.random().toString(36).slice(2, 11)}`

// State for property panel
const selectedNode = ref<{ pos: number; node: any } | null>(null)
const isPropertyPanelOpen = ref(false)

// Listen for block edit requests from NodeView components
// (They can't use provide/inject due to VueNodeViewRenderer boundary)
// IMPORTANT: Only handle events for THIS editor instance (check editorId)
function handleBlockEditRequest(event: Event) {
  const customEvent = event as CustomEvent<{ node: any; pos: number; editorId?: string }>
  const eventEditorId = customEvent.detail.editorId

  // Only handle if event has an editorId that matches this editor
  // If editorId is missing (DOM traversal failed), skip to avoid duplicate handling
  if (!eventEditorId || eventEditorId !== editorId) {
    return
  }

  selectedNode.value = { pos: customEvent.detail.pos, node: customEvent.detail.node }
  isPropertyPanelOpen.value = true
  emit('block:edit', customEvent.detail)
}

onMounted(() => {
  document.addEventListener('block-edit-request', handleBlockEditRequest)
})

onUnmounted(() => {
  document.removeEventListener('block-edit-request', handleBlockEditRequest)
})

// Handle editor creation
function handleEditorCreate(event: { editor: Editor }) {
  editorInstance.value = event.editor
  emit('create', event)
}

// UEditor declares no `create`/`update` events (only update:modelValue), and
// its internal useEditor options clobber a consumer-passed onCreate/onUpdate —
// so @create above never fires. Capture the instance from UEditor's exposed
// `editor` ref instead; the :key remount (collab extensions loading) swaps the
// template ref, so this also re-captures the recreated editor.
const ueditorRef = ref<{ editor?: unknown } | null>(null)
watch(() => ueditorRef.value?.editor, (ed) => {
  // UEditor's exposed editor comes from @nuxt/ui's own tiptap type tree, which
  // vue-tsc treats as structurally different from our @tiptap/vue-3 Editor —
  // it's the same runtime object, so cast across the duplicate type identity.
  const editor = ed as Editor | undefined
  if (editor && editor !== editorInstance.value) {
    handleEditorCreate({ editor })
    editor.on('update', () => handleEditorUpdate({ editor }))
  }
})

// Track selection changes to find selected block
function handleEditorUpdate(event: { editor: Editor }) {
  const editor = event.editor
  const { from } = editor.state.selection
  const $pos = editor.state.doc.resolve(from)

  // Find the nearest block node
  for (let depth = $pos.depth; depth > 0; depth--) {
    const node = $pos.node(depth)
    if (node.type.name.endsWith('Block')) {
      const pos = $pos.before(depth)
      selectedNode.value = { pos, node }
      emit('block:select', selectedNode.value)
      emit('update', event)
      return
    }
  }

  selectedNode.value = null
  emit('block:select', null)
  emit('update', event)
}

// Open property panel for selected block
function openPropertyPanel() {
  if (selectedNode.value) {
    isPropertyPanelOpen.value = true
    emit('block:edit', selectedNode.value)
  }
}

// Close property panel
function closePropertyPanel() {
  isPropertyPanelOpen.value = false
}

// Update block attributes
function updateBlockAttrs(attrs: Record<string, unknown>) {
  if (!editorInstance.value || !selectedNode.value) return

  const { pos, node: originalNode } = selectedNode.value
  const expectedType = originalNode?.type?.name

  // Get fresh state from editor (important for collaborative editing where state can change)
  const view = editorInstance.value.view
  const state = view.state

  try {
    // Get the node at the stored position
    let node = state.doc.nodeAt(pos)
    let actualPos = pos

    // Verify the node is the correct block type
    // If position is stale (e.g., due to document changes), try to find the block
    if (!node || node.isText || node.type.name !== expectedType) {
      // Position is invalid - try to find the block by searching the document
      let found = false
      state.doc.descendants((n, p) => {
        if (found) return false
        if (n.type.name === expectedType) {
          // Found a block of the same type - use it
          // Note: This is a best-effort recovery, might update wrong block if multiple exist
          node = n
          actualPos = p
          found = true
          return false
        }
        return true
      })

      if (!found || !node) {
        console.warn('[CroutonEditorBlocks] Cannot update attrs: block not found in document')
        return
      }
    }

    // Use TipTap's chain for reliable NodeView updates
    // setNodeSelection ensures the block is selected, updateAttributes applies the change
    editorInstance.value
      .chain()
      .setNodeSelection(actualPos)
      .updateAttributes(expectedType, attrs)
      .run()

    // Update selectedNode with the correct position
    selectedNode.value = { pos: actualPos, node }
  } catch (error) {
    // Position errors can occur during collaborative editing when document changes
    console.warn('[CroutonEditorBlocks] Failed to update block attrs (document may have changed):', error)
  }
}

// Delete selected block
function deleteSelectedBlock() {
  if (!editorInstance.value || !selectedNode.value) return

  const { pos } = selectedNode.value
  editorInstance.value.chain()
    .focus()
    .setNodeSelection(pos)
    .deleteSelection()
    .run()

  selectedNode.value = null
  isPropertyPanelOpen.value = false
}

// Convert block items to suggestion menu items with handlers
const suggestionMenuItems = computed<EditorSuggestionMenuItem[][]>(() => {
  if (!props.suggestionItems?.length) return []

  // Group by category
  const categories = new Map<string, BlockSuggestionItem[]>()
  for (const item of props.suggestionItems) {
    const cat = item.category || 'Blocks'
    if (!categories.has(cat)) {
      categories.set(cat, [])
    }
    categories.get(cat)!.push(item)
  }

  // Build menu structure
  const result: EditorSuggestionMenuItem[][] = []

  for (const [category, items] of categories) {
    const group: EditorSuggestionMenuItem[] = [
      { type: 'label', label: category }
    ]

    for (const item of items) {
      group.push({
        label: item.label,
        icon: item.icon,
        // Use custom kind that maps to our handler
        kind: item.command as any
      })
    }

    result.push(group)
  }

  return result
})

// Custom handlers for block insertion
// These are passed to UEditor and used by UEditorSuggestionMenu
// Format: { [kind]: { execute: (editor) => chain, isActive?: (editor) => boolean } }
const blockHandlers = computed(() => {
  const handlers: Record<string, { execute: (editor: Editor) => any; isActive?: (editor: Editor) => boolean }> = {}

  for (const item of props.suggestionItems || []) {
    handlers[item.command] = {
      execute: (editor: Editor) => {
        // Try to call the registered command on the editor
        // Primary: use the specified command name (e.g., 'insertFaqBlock')
        let command = (editor.commands as any)[item.command]

        // Fallback: if command not found, try the standard insert prefix pattern
        // e.g., 'faqBlock' → 'insertFaqBlock' (handles stale command name mappings)
        if (!command && item.command.endsWith('Block')) {
          const insertCmd = 'insert' + item.command.charAt(0).toUpperCase() + item.command.slice(1)
          command = (editor.commands as any)[insertCmd]
        }

        if (command) {
          command()
        }
        // Return a chain for compatibility with UEditor handler system
        return editor.chain().focus()
      },
      isActive: (editor: Editor) => {
        // Check if this block type is currently selected
        return editor.isActive(item.type)
      }
    }
  }

  return handlers
})

// Base toolbar items - computed to conditionally include undo/redo
// In collab mode, undo/redo is handled by y-prosemirror which doesn't
// register the same commands, so we hide the buttons to avoid errors
const toolbarItems = computed<EditorToolbarItem[][]>(() => {
  const items: EditorToolbarItem[][] = []

  // Only include undo/redo when NOT in collab mode
  if (!isCollabMode.value) {
    items.push(undoRedoGroup)
  }

  // Formatting groups (always shown) — composed from shared presets
  items.push(blockTypesGroup, marksGroup, linkGroup)

  return items
})

// Bubble toolbar items — composed from shared presets
const bubbleToolbarItems: EditorToolbarItem[][] = [
  bubbleTurnIntoSlim,
  bubbleMarksSlim,
  linkGroup
]

// Expose editor instance and utilities
defineExpose({
  editor: editorInstance,
  editorId,
  selectedNode,
  isPropertyPanelOpen,
  isCollabMode,
  openPropertyPanel,
  closePropertyPanel,
  updateBlockAttrs,
  deleteSelectedBlock
})
</script>

<template>
  <div class="crouton-editor-blocks h-full flex flex-col overflow-hidden" :data-editor-id="editorId">
    <!-- Toolbar using captured editor instance -->
    <UEditorToolbar
      v-if="editorInstance && showToolbar"
      :editor="(editorInstance as any)"
      :items="toolbarItems"
      class="border-b border-default px-2 py-1.5 flex-shrink-0"
    />

    <!-- Editor with slash command suggestion menu -->
    <!-- In collab mode, content syncs via Yjs, not v-model -->
    <!-- Key forces recreation when collab extensions load -->
    <UEditor
      ref="ueditorRef"
      v-slot="{ editor, handlers }"
      :key="editorKey"
      v-model="(content as any)"
      :content-type="contentType"
      :placeholder="placeholder"
      :editable="editable"
      :autofocus="autofocus"
      :starter-kit="(starterKitOptions as any)"
      :extensions="allExtensions"
      :handlers="(blockHandlers as any)"
      class="flex-1 min-h-0"
      :ui="{
        root: 'h-full flex flex-col',
        content: 'flex-1 min-h-0 p-4 pl-10 prose prose-sm dark:prose-invert max-w-none overflow-auto'
      }"
      @create="handleEditorCreate as any"
      @update="handleEditorUpdate as any"
    >
      <!-- Global drag handle for all blocks -->
      <UEditorDragHandle
        v-if="editable"
        v-slot="{ ui, onClick }"
        :editor="editor"
      >
        <!-- Plus button to add blocks -->
        <UButton
          icon="i-lucide-plus"
          color="neutral"
          variant="ghost"
          size="xs"
          :class="ui.handle()"
          @click="(e: MouseEvent) => {
            e.stopPropagation()
            const selected = onClick()
            if (suggestionMenuItems.length > 0) {
              handlers.suggestion?.execute(editor, { pos: selected?.pos }).run()
            }
          }"
        />
        <!-- Drag grip -->
        <UButton
          icon="i-lucide-grip-vertical"
          color="neutral"
          variant="ghost"
          size="xs"
          :class="ui.handle()"
        />
      </UEditorDragHandle>

      <!-- Slash command menu for block insertion -->
      <UEditorSuggestionMenu
        v-if="suggestionMenuItems.length > 0"
        :editor="editor"
        :items="suggestionMenuItems"
      />

      <!-- Bubble toolbar on text selection -->
      <UEditorToolbar
        v-if="showBubbleToolbar"
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

    <!-- Property Panel Slot -->
    <slot
      name="property-panel"
      :selected-node="selectedNode"
      :is-open="isPropertyPanelOpen"
      :close="closePropertyPanel"
      :update-attrs="updateBlockAttrs"
      :delete-block="deleteSelectedBlock"
    >
      <!-- Default: no property panel, consumer provides via slot -->
    </slot>
  </div>
</template>

<style>
/* Block selection styling */
.crouton-editor-blocks :deep(.ProseMirror-selectednode) {
  outline: 2px solid var(--ui-primary);
  outline-offset: 2px;
  border-radius: 0.5rem;
}

/* Block wrapper in editor */
.crouton-editor-blocks :deep(.block-wrapper) {
  position: relative;
  margin: 1rem 0;
}

.crouton-editor-blocks :deep(.block-wrapper:hover .block-actions) {
  opacity: 1;
}

.crouton-editor-blocks :deep(.block-actions) {
  position: absolute;
  top: 0.5rem;
  right: 0.5rem;
  opacity: 0;
  transition: opacity 0.2s;
}
</style>
