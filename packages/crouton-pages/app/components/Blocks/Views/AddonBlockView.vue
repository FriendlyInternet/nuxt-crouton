<script setup lang="ts">
/**
 * Addon Block Editor View
 *
 * Generic NodeView wrapper for addon blocks (chart, map, etc.).
 * Reads the block definition from TipTap extension storage (set by addon-block-factory)
 * and renders the addon package's editor view component.
 *
 * Falls back to a placeholder if the definition or component is not found.
 *
 * Note: Uses explicit imports because this component is loaded
 * via VueNodeViewRenderer which bypasses Nuxt auto-imports.
 */
import { computed, ref, resolveComponent } from 'vue'
import { NodeViewWrapper } from '@tiptap/vue-3'
import type { CroutonBlockDefinition } from '@fyit/crouton-core/app/types/block-definition'

const props = defineProps<{
  node: { type: { name: string; storage?: { blockDefinition?: CroutonBlockDefinition } }; attrs: Record<string, unknown> }
  editor: any
  selected: boolean
  updateAttributes: (attrs: Record<string, unknown>) => void
  deleteNode: () => void
  getPos: () => number
}>()

// Read block definition from TipTap extension storage (set by addon-block-factory)
const blockDef = computed(() => {
  // Try extension storage first (set by createAddonBlockExtension)
  const storageDef = props.editor?.extensionManager?.extensions
    ?.find((ext: any) => ext.name === props.node.type.name)?.storage?.blockDefinition
  if (storageDef) return storageDef as CroutonBlockDefinition
  // Fallback: read from node type storage
  return props.node.type.storage?.blockDefinition || null
})

// Resolve the editor view component from the addon package
const editorViewComponent = computed(() => {
  if (!blockDef.value?.components.editorView) return null
  return resolveComponent(blockDef.value.components.editorView)
})

const { t } = useT()
const innerRef = ref<HTMLElement | null>(null)

function findEditorId(): string | undefined {
  let el: HTMLElement | null = innerRef.value
  while (el) {
    if (el.classList?.contains('crouton-editor-blocks') && el.dataset?.editorId) {
      return el.dataset.editorId
    }
    el = el.parentElement
  }
  return undefined
}

function handleOpenPanel() {
  const editorId = findEditorId()
  const event = new CustomEvent('block-edit-request', {
    bubbles: true,
    detail: { node: props.node, pos: props.getPos(), editorId }
  })
  document.dispatchEvent(event)
}
</script>

<template>
  <NodeViewWrapper
    class="block-wrapper my-1 cursor-pointer"
    :class="{ 'border-l-2 border-l-primary/50': selected }"
    :data-type="node.type.name"
    @dblclick="handleOpenPanel"
  >
    <div ref="innerRef">
      <!-- Render the addon package's editor view component if available -->
      <component
        :is="editorViewComponent"
        v-if="editorViewComponent && typeof editorViewComponent !== 'string'"
        :node="node"
        :selected="selected"
        :update-attributes="updateAttributes"
        :delete-node="deleteNode"
        :get-pos="getPos"
      />

      <!-- Fallback: block definition found but component not resolved -->
      <div
        v-else-if="blockDef"
        class="relative group rounded border border-transparent hover:border-gray-200/50 dark:hover:border-gray-700/50 transition-colors"
      >
        <div class="p-3">
          <div class="flex items-center justify-between mb-2">
            <span class="inline-flex items-center gap-1 text-[10px] font-medium text-gray-400 uppercase tracking-wider">
              {{ blockDef.name }}
            </span>
            <div class="opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-0.5">
              <UButton
                color="neutral"
                variant="ghost"
                size="xs"
                square
                icon="i-lucide-pencil"
                class="text-dimmed hover:text-primary"
                :aria-label="t('pages.blocks.editBlock')"
                :title="t('pages.blocks.editBlock')"
                @click.stop="handleOpenPanel"
              />
              <UButton
                color="neutral"
                variant="ghost"
                size="xs"
                square
                icon="i-lucide-trash-2"
                class="text-dimmed hover:text-error"
                :aria-label="t('pages.blocks.deleteBlock')"
                :title="t('pages.blocks.deleteBlock')"
                @click.stop="deleteNode"
              />
            </div>
          </div>
          <div class="bg-gray-50/50 dark:bg-gray-800/30 rounded-lg p-4 border border-gray-100 dark:border-gray-700/50">
            <p class="text-sm text-muted">{{ blockDef.description }}</p>
          </div>
        </div>
      </div>

      <!-- Unknown block type -->
      <div
        v-else
        class="p-3 rounded bg-warning/10 border border-warning/20"
      >
        <p class="text-sm text-warning">Unknown addon block: {{ node.type.name }}</p>
      </div>
    </div>
  </NodeViewWrapper>
</template>
