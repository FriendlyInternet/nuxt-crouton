<script setup lang="ts">
/**
 * BoardSheetPane — the selected pane's options: display variant, hidden at
 * this width, and (when hidden) where its trigger lives + how it opens.
 */
import type { LayoutLeaf, LayoutCollapseRecipe } from '@fyit/crouton-core/app/types/layout'
import type { CroutonLayoutBlockDefinition } from '@fyit/crouton-core/app/types/layout-block'
import { normalizeCollapseRecipe, LAYOUT_COLLAPSE_EDGES } from '@fyit/crouton-core/app/types/layout'
import { collapsePlacement, collapseReveal, paneKey } from '~/utils/board-hidden'

const props = defineProps<{
  leaf: LayoutLeaf
  def: CroutonLayoutBlockDefinition | null
  hidden: boolean
}>()
const emit = defineEmits<{
  setField: [name: string, value: unknown]
  toggleHidden: [key: string]
  setRecipe: [leaf: LayoutLeaf, patch: Partial<LayoutCollapseRecipe>]
}>()

const selectFields = computed(() => (props.def?.configSchema ?? []).filter(f => f.type === 'select' && f.options?.length))
const recipe = computed(() => normalizeCollapseRecipe(props.leaf.collapse))

const placementItems = [{ label: 'On its edge', value: 'edge' }, { label: 'In the nav', value: 'nav' }]
const edgeItems = LAYOUT_COLLAPSE_EDGES.map(e => ({ label: e[0]!.toUpperCase() + e.slice(1), value: e }))
const revealItems = [
  { label: 'Slideover', value: 'slideover' },
  { label: 'Bottom sheet', value: 'sheet' },
  { label: 'Modal', value: 'modal' },
  { label: 'Full page', value: 'page' },
]
const patch = (p: Partial<LayoutCollapseRecipe>) => emit('setRecipe', props.leaf, p)
</script>

<template>
  <div class="space-y-4">
    <UFormField v-for="f in selectFields" :key="f.name" :label="f.label ?? f.name">
      <USelect
        :model-value="(leaf.config?.[f.name] as string) ?? f.default"
        :items="f.options"
        class="w-full"
        @update:model-value="v => emit('setField', f.name, v)"
      />
    </UFormField>

    <USeparator />
    <div class="flex items-center justify-between">
      <span class="text-sm">Hidden at this width</span>
      <USwitch :model-value="hidden" data-handoff="hidden-toggle" @update:model-value="emit('toggleHidden', paneKey(leaf))" />
    </div>
    <template v-if="hidden">
      <UFormField label="Trigger">
        <USelect :model-value="collapsePlacement(recipe)" :items="placementItems" class="w-full" data-handoff="recipe-placement" @update:model-value="v => patch({ placement: v as LayoutCollapseRecipe['placement'] })" />
      </UFormField>
      <UFormField v-if="collapsePlacement(recipe) === 'edge'" label="Edge">
        <USelect :model-value="recipe.edge" :items="edgeItems" class="w-full" @update:model-value="v => patch({ edge: v as LayoutCollapseRecipe['edge'] })" />
      </UFormField>
      <UFormField label="Opens as">
        <USelect :model-value="collapseReveal(recipe)" :items="revealItems" class="w-full" data-handoff="recipe-reveal" @update:model-value="v => patch({ reveal: v as LayoutCollapseRecipe['reveal'] })" />
      </UFormField>
    </template>
  </div>
</template>
