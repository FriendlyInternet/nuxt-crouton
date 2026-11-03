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
import { useBlockEditRequest } from '@fyit/crouton-core/app/composables/useBlockEditRequest'
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
const { blockName, blockDescription } = useBlockI18n()
const innerRef = ref<HTMLElement | null>(null)
const { openPanel } = useBlockEditRequest(innerRef)

// The addon's own editor view has no shared frame, so double-click opens the panel here
function handleOpenPanel() {
  openPanel(props.node, props.getPos())
}


</script>

<template>
  <NodeViewWrapper :data-type="node.type.name">
    <div
      v-if="editorViewComponent && typeof editorViewComponent !== 'string'"
      ref="innerRef"
      class="block-wrapper my-1 cursor-pointer"
      :class="{ 'border-l-2 border-l-primary/50': selected }"
      @dblclick="handleOpenPanel"
    >
      <!-- Render the addon package's editor view component if available -->
      <component
        :is="editorViewComponent"
        :node="node"
        :selected="selected"
        :update-attributes="updateAttributes"
        :delete-node="deleteNode"
        :get-pos="getPos"
      />
    </div>

    <!-- Fallback: block definition found but component not resolved -->
    <CroutonBlockFrame
      v-else-if="blockDef"
      :node="node"
      :get-pos="getPos"
      :selected="selected"
      :label="blockName(blockDef)"
      @delete="deleteNode"
    >
      <div class="bg-gray-50/50 dark:bg-gray-800/30 rounded-lg p-4 border border-gray-100 dark:border-gray-700/50">
        <p class="text-sm text-muted">{{ blockDescription(blockDef) }}</p>
      </div>
    </CroutonBlockFrame>

    <!-- Unknown block type -->
    <div
      v-else
      class="my-1 p-3 rounded bg-warning/10 border border-warning/20"
    >
      <p class="text-sm text-warning">{{ t('pages.blockViews.unknownAddon', { name: node.type.name }) }}</p>
    </div>
  </NodeViewWrapper>
</template>
