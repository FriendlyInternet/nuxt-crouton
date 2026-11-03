<script setup lang="ts">
/**
 * CroutonLayoutForm — a REAL data-bound form block (Sprint 4, #709).
 *
 * The "detail" half of a master/detail layout: edits whatever record the page's
 * shared selection holds for its collection (#2598) — a row tapped in a List block
 * opens here — and is a create form when nothing is selected. While mounted it tells
 * the selection a form is on screen; a layout without it (e.g. the phone layout)
 * opens rows in the overlay instead. Editing goes through core's `CroutonWorkspaceEditor`.
 *
 * Container-responsive (#710) and tolerant of a missing `collection` (a freshly
 * dropped, unconfigured block) — shows a hint instead of erroring.
 *
 * Renders by context (#983, same split as `CroutonLayoutCollection`): `admin`
 * fills its pane and scrolls internally; `page` (a served page) is content-sized
 * — a `h-full` + `overflow-auto` block inside a content-sized grid row collapses
 * to nothing on WebKit (owner-reported on iOS, #2490), so the page render never
 * depends on a percentage height.
 */
import { computed, inject, ref, watch, watchEffect, type Ref } from 'vue'
import { LAYOUT_RENDER_CONTEXT_KEY, type LayoutRenderContext } from '../composables/useCroutonLayoutRenderContext'

const props = withDefaults(defineProps<{
  collection?: string
  /** Optional heading (the composer passes the collection label). */
  heading?: string
}>(), {})

const renderContext = inject<Ref<LayoutRenderContext>>(
  LAYOUT_RENDER_CONTEXT_KEY,
  ref<LayoutRenderContext>('admin'),
)
const isPage = computed(() => renderContext.value === 'page')

const selections = useCollectionSelections()
const selection = computed(() => props.collection ? selections.get(props.collection) : null)
watchEffect((onCleanup) => {
  if (selection.value) onCleanup(selection.value.attachEditor())
})
// Nothing selected (or a cancelled new record) → a fresh create form.
const editingId = computed(() => selection.value?.mode.value === 'edit' ? selection.value.itemId.value : null)

// When a row opens here, bring the form into view — on a phone the board stacks
// it below the list, so without this the tap changes something off-screen.
const root = ref<HTMLElement | null>(null)
watch(() => selection.value?.sessionKey.value, (now, before) => {
  if (before !== undefined && now !== before) root.value?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
})
</script>

<template>
  <div ref="root" class="@container" :class="isPage ? '' : 'h-full overflow-auto'">
    <div v-if="heading" class="px-4 py-2 border-b border-default text-sm font-semibold">
      {{ heading }}
    </div>

    <CroutonWorkspaceEditor
      v-if="collection && selection"
      :key="`${collection}:${selection.sessionKey.value}`"
      :collection="collection"
      :item-id="editingId"
      @save="selection.saved"
      @delete="selection.deleted"
      @cancel="selection.cancelled"
    />

    <div
      v-else
      class="flex-1 flex items-center justify-center p-6 text-sm text-muted text-center"
    >
      Configure a collection to show its form.
    </div>
  </div>
</template>
