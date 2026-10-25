<script setup lang="ts">
/**
 * BoardSheet — the bottom sheet under the board: the selected pane's options
 * and the list of blocks hidden at this width. Pure UI; the page owns the tree
 * and applies the emitted edits.
 */
import type { LayoutLeaf, LayoutCollapseRecipe } from '@fyit/crouton-core/app/types/layout'
import type { CroutonLayoutBlockDefinition } from '@fyit/crouton-core/app/types/layout-block'
import type { NodePath } from '@fyit/crouton-layout/app/utils/layout-edit'
import type { HiddenItem } from '~/utils/board-hidden'

defineProps<{
  selected: NodePath | null
  leaf: LayoutLeaf | null
  def: CroutonLayoutBlockDefinition | null
  hidden: boolean
  hiddenItems: HiddenItem[]
}>()
const open = defineModel<boolean>('open', { default: false })
const emit = defineEmits<{
  setField: [name: string, value: unknown]
  toggleHidden: [blockId: string]
  setRecipe: [leaf: LayoutLeaf, patch: Partial<LayoutCollapseRecipe>]
  remove: []
  selectHidden: [item: HiddenItem]
}>()
</script>

<template>
  <UDrawer v-model:open="open" :overlay="false" :modal="false" :handle="true">
    <template #content>
      <!-- Bottom padding clears the floating review overlay. -->
      <div class="space-y-4 p-4 pb-24">
        <div class="flex items-center gap-2">
          <UIcon :name="def?.icon ?? 'i-lucide-box'" class="size-4" />
          <span class="font-medium">{{ def?.name ?? leaf?.blockId ?? 'Pane' }}</span>
          <span v-if="selected" class="ml-auto text-xs text-muted">pane {{ selected.join('.') || 'root' }}</span>
        </div>

        <BoardSheetPane
          v-if="leaf"
          :leaf="leaf"
          :def="def"
          :hidden="hidden"
          @set-field="(n, v) => emit('setField', n, v)"
          @toggle-hidden="id => emit('toggleHidden', id)"
          @set-recipe="(l, p) => emit('setRecipe', l, p)"
        />
        <UButton v-if="selected" color="error" variant="soft" icon="i-lucide-trash-2" label="Remove from page" @click="emit('remove')" />

        <template v-if="hiddenItems.length">
          <USeparator />
          <BoardSheetHidden :items="hiddenItems" @select="item => emit('selectHidden', item)" @show="id => emit('toggleHidden', id)" />
        </template>
      </div>
    </template>
  </UDrawer>
</template>
