<script setup lang="ts">
/**
 * CroutonLayout — the editable panes surface (Sprint 3, #706).
 *
 * A NEW component (the read-only `CroutonLayoutRenderer` is left untouched for
 * `paneBlock` public render). It wraps the renderer with a compose loop:
 *   • a palette of registered `croutonLayoutBlocks` you drag into panes,
 *   • the editable canvas (recursive `CroutonLayoutEditorPane` on reka-ui's
 *     Splitter — drag onto an edge to split/nest, center to swap, resize),
 *   • a per-block config panel (driven by the block's `configSchema`),
 *   • a live viability badge (every block ≥ its `minWidth` at the target widths),
 *   • a preview toggle that renders the read-only result.
 *
 * The `LayoutTree` is the single source of truth: every gesture is a pure
 * transform from `utils/layout-edit`, and the result is emitted via v-model so
 * the owner can persist it (see `useCroutonLayoutStore`). The persisted tree is
 * untrusted on the way back in — leaves are allowlisted by the registry and
 * config is sanitized at render.
 */
import { computed, provide, ref, watch } from 'vue'
import type { LayoutTree, LayoutNode } from '@fyit/crouton-core/app/types/layout'
import {
  dropBlock,
  removeNode,
  applySizes,
  setConfig,
  getNode,
  type NodePath,
  type DropEdge,
} from '../utils/layout-edit'
import {
  LAYOUT_EDIT_KEY,
  pathKey,
  parsePathKey,
  type LayoutEditApi,
} from '../composables/useCroutonLayoutEdit'

const props = withDefaults(
  defineProps<{
    /** The layout tree to edit (v-model). `null` = empty canvas. */
    modelValue?: LayoutTree | null
    /** When false, render the read-only result only (no palette / edit chrome). */
    editable?: boolean
    /** Container widths the viability badge checks against (px). */
    targetWidths?: number[]
  }>(),
  { modelValue: null, editable: true, targetWidths: () => [1280, 768, 375] },
)

const emit = defineEmits<{ 'update:modelValue': [LayoutTree | null] }>()

const { blocksList, getBlock, checkViability } = useCroutonLayoutBlocks()

// Local working copy of the root; synced from v-model, emitted on every edit.
const root = ref<LayoutNode | null>(props.modelValue?.root ?? null)
watch(
  () => props.modelValue,
  v => { root.value = v?.root ?? null },
)

function apply(next: LayoutNode | null) {
  root.value = next
  emit('update:modelValue', next ? { renderer: 'panes', root: next } : null)
}

// ---- Edit API (provided to every editor pane) -----------------------------
const dragging = ref(false)
const selectedPath = ref<string | null>(null)

const editApi: LayoutEditApi = {
  dragging,
  selectedPath,
  drop(path, blockId, edge) {
    apply(dropBlock(root.value, path, blockId, edge, getBlock(blockId)))
  },
  remove(path) {
    apply(removeNode(root.value, path))
    selectedPath.value = null
  },
  resize(path, sizes) {
    if (root.value) apply(applySizes(root.value, path, sizes))
  },
  select(path) {
    selectedPath.value = pathKey(path)
  },
}
provide(LAYOUT_EDIT_KEY, editApi)

// ---- Palette drag ----------------------------------------------------------
const DROP_MIME = 'application/x-crouton-block'
function onPaletteDragStart(e: DragEvent, blockId: string) {
  e.dataTransfer?.setData(DROP_MIME, blockId)
  if (e.dataTransfer) e.dataTransfer.effectAllowed = 'copy'
  dragging.value = true
}
function onPaletteDragEnd() {
  dragging.value = false
}
function onEmptyDrop(e: DragEvent) {
  e.preventDefault()
  const blockId = e.dataTransfer?.getData(DROP_MIME)
  if (blockId) editApi.drop([], blockId, 'center')
}
function allowDrop(e: DragEvent) {
  if (e.dataTransfer?.types.includes(DROP_MIME)) e.preventDefault()
}

// ---- Preview toggle --------------------------------------------------------
const previewing = ref(false)

// ---- Viability badge -------------------------------------------------------
const viability = computed(() =>
  root.value
    ? checkViability({ renderer: 'panes', root: root.value }, props.targetWidths)
    : { viable: true, violations: [] },
)

// ---- Config panel for the selected leaf ------------------------------------
const selectedNode = computed<LayoutNode | null>(() =>
  selectedPath.value !== null && root.value
    ? getNode(root.value, parsePathKey(selectedPath.value))
    : null,
)
const selectedLeaf = computed(() =>
  selectedNode.value?.type === 'leaf' ? selectedNode.value : null,
)
const selectedDef = computed(() =>
  selectedLeaf.value ? getBlock(selectedLeaf.value.blockId) : undefined,
)

/** Current value for a config field, falling back to its default. */
function fieldValue(name: string): unknown {
  const field = selectedDef.value?.configSchema?.find(f => f.name === name)
  return selectedLeaf.value?.config?.[name] ?? field?.default
}
function updateField(name: string, value: unknown) {
  if (!selectedLeaf.value || selectedPath.value === null) return
  const next = { ...(selectedLeaf.value.config ?? {}), [name]: value }
  apply(setConfig(root.value!, parsePathKey(selectedPath.value), next))
}

function clearLayout() {
  apply(null)
  selectedPath.value = null
}
</script>

<template>
  <!-- Read-only mode: just the renderer -->
  <div v-if="!editable" class="h-full w-full">
    <CroutonLayoutRenderer v-if="root" :node="root" />
    <div v-else class="h-full w-full flex items-center justify-center text-sm text-muted">
      Empty layout
    </div>
  </div>

  <!-- Editable mode -->
  <div v-else class="crouton-layout @container flex h-full w-full flex-col">
    <!-- Toolbar -->
    <div class="flex flex-wrap items-center gap-2 border-b border-default px-3 py-2">
      <UBadge
        :color="viability.viable ? 'success' : 'warning'"
        variant="subtle"
        :icon="viability.viable ? 'i-lucide-check' : 'i-lucide-triangle-alert'"
      >
        {{ viability.viable ? 'Viable' : `${viability.violations.length} too narrow` }}
      </UBadge>
      <div class="flex-1" />
      <UButton
        size="xs"
        variant="ghost"
        :icon="previewing ? 'i-lucide-pencil' : 'i-lucide-eye'"
        @click="previewing = !previewing"
      >
        {{ previewing ? 'Edit' : 'Preview' }}
      </UButton>
      <UButton
        size="xs"
        variant="ghost"
        color="neutral"
        icon="i-lucide-rotate-ccw"
        :disabled="!root"
        @click="clearLayout"
      >
        Clear
      </UButton>
    </div>

    <!-- Narrow (its container, not the viewport): palette = top scroll strip,
         canvas full width, config = bottom sheet. Side-by-side from @2xl. -->
    <div class="relative flex min-h-0 flex-1 flex-col @2xl:flex-row">
      <!-- Palette -->
      <aside
        v-if="!previewing"
        class="shrink-0 border-b border-default p-2 @2xl:w-52 @2xl:overflow-auto @2xl:border-b-0 @2xl:border-r"
      >
        <p class="px-1 pb-2 text-xs font-semibold uppercase tracking-wide text-muted">
          Blocks
        </p>
        <ul class="flex flex-row gap-1 overflow-x-auto @2xl:flex-col @2xl:overflow-x-visible">
          <li
            v-for="block in blocksList"
            :key="block.id"
            draggable="true"
            data-testid="palette-item"
            :data-block-id="block.id"
            class="flex shrink-0 cursor-grab items-center gap-2 rounded-md border border-default bg-elevated/40 px-2 py-1.5 text-sm hover:border-primary hover:bg-primary/5 active:cursor-grabbing transition-colors @2xl:shrink"
            @dragstart="onPaletteDragStart($event, block.id)"
            @dragend="onPaletteDragEnd"
          >
            <UIcon :name="block.icon" class="size-4 shrink-0 text-muted" />
            <span class="truncate">{{ block.name }}</span>
          </li>
        </ul>
        <p v-if="!blocksList.length" class="px-1 text-xs text-muted">
          No blocks registered.
        </p>
      </aside>

      <!-- Canvas -->
      <div class="relative min-w-0 flex-1">
        <!-- Preview -->
        <CroutonLayoutRenderer v-if="previewing && root" :node="root" />

        <!-- Empty drop target -->
        <div
          v-else-if="!root"
          data-testid="empty-drop"
          class="flex h-full w-full items-center justify-center p-6"
          @dragover="allowDrop"
          @drop="onEmptyDrop"
        >
          <div
            class="flex flex-col items-center gap-2 rounded-xl border-2 border-dashed border-default px-10 py-12 text-center text-sm text-muted transition-colors"
            :class="dragging ? 'border-primary bg-primary/5 text-primary' : ''"
          >
            <UIcon name="i-lucide-layout-template" class="size-8" />
            <span>Drag a block here to start</span>
          </div>
        </div>

        <!-- Editable tree -->
        <CroutonLayoutEditorPane v-else :node="root" :path="[]" />
      </div>

      <!-- Config panel: slide-out drawer from the right on a narrow container, static side column from @2xl -->
      <Transition
        enter-active-class="transition-transform duration-200 ease-out"
        enter-from-class="translate-x-full @2xl:translate-x-0"
        leave-active-class="transition-transform duration-150 ease-in"
        leave-to-class="translate-x-full @2xl:translate-x-0"
      >
        <aside
          v-if="!previewing && selectedLeaf"
          data-testid="config-panel"
          class="absolute inset-y-0 right-0 z-30 w-[85%] max-w-sm overflow-auto border-l border-default bg-default p-3 shadow-xl @2xl:static @2xl:inset-auto @2xl:z-auto @2xl:w-64 @2xl:max-w-none @2xl:shrink-0 @2xl:shadow-none"
        >
        <div class="flex items-center justify-between pb-2">
          <p class="text-xs font-semibold uppercase tracking-wide text-muted">
            {{ selectedDef?.name || selectedLeaf.blockId }}
          </p>
          <UButton
            size="xs"
            variant="ghost"
            color="neutral"
            icon="i-lucide-x"
            aria-label="Close config"
            @click="selectedPath = null"
          />
        </div>

        <div
          v-if="selectedDef?.configSchema?.length"
          class="flex flex-col gap-3"
        >
          <UFormField
            v-for="field in selectedDef.configSchema"
            :key="field.name"
            :label="field.label || field.name"
            :name="field.name"
          >
            <USwitch
              v-if="field.type === 'boolean'"
              :model-value="Boolean(fieldValue(field.name))"
              @update:model-value="updateField(field.name, $event)"
            />
            <UInputNumber
              v-else-if="field.type === 'number'"
              :model-value="Number(fieldValue(field.name) ?? 0)"
              @update:model-value="updateField(field.name, $event)"
            />
            <USelect
              v-else-if="field.type === 'select'"
              :model-value="String(fieldValue(field.name) ?? '')"
              :items="field.options || []"
              @update:model-value="updateField(field.name, $event)"
            />
            <UInput
              v-else
              :model-value="String(fieldValue(field.name) ?? '')"
              @update:model-value="updateField(field.name, $event)"
            />
          </UFormField>
        </div>
        <p v-else class="text-xs text-muted">
          This block has no configurable options.
        </p>
        </aside>
      </Transition>
    </div>
  </div>
</template>
