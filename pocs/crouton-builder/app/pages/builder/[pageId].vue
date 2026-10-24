<script setup lang="ts">
/**
 * /builder/[pageId] — the PAGE BOARD, rebuilt phone-first (#2375).
 *
 * The page's LayoutTree fills the screen as a plain splitter tree (BoardTree):
 * drag a pane edge to resize, drag a block chip from the strip at the bottom
 * onto any pane edge to add it there, drag a pane's grip onto another pane to
 * move it. Tap a pane to select it; the bottom sheet shows its options.
 *
 * What's deliberately gone vs the Vue Flow board: the free-floating candidate
 * cards, the custom pointer-capture drag, the dwell timer and the ghost leaf
 * spliced into the tree. Drops are native browser drag events; the tree only
 * changes on drop, through the package's layout-edit helpers.
 *
 * Persistence is unchanged: explicit Save → `board.layout` on the builderPages
 * row via the canonical `layout-serialize` (specs `board-persistence`,
 * `layouttree-serialise`).
 */
import type { LayoutNode, LayoutTree, LayoutBreakpoint, LayoutLeaf } from '@fyit/crouton-core/app/types/layout'
import { serializeLayoutTree, parseLayoutTree } from '@fyit/crouton-layout/app/utils/layout-serialize'
import {
  getNode, makeLeaf, dropBlock, dropNode, applyPaneDrop, detachNode, findNodePath,
  nestInside, applySizes, setConfig, removeNode,
  type NodePath, type DropEdge,
} from '@fyit/crouton-layout/app/utils/layout-edit'
import { useBoardDrag, type BoardDragPayload } from '~/utils/board-drag'
import type { BuilderPage } from '~~/layers/builder/collections/pages/types'

definePageMeta({ middleware: ['auth'] })

const route = useRoute()
const pageId = computed(() => String(route.params.pageId))

const { items: pages } = await useCollectionQuery('builderPages')
const page = computed(() => (pages.value as BuilderPage[]).find(p => p.id === pageId.value) ?? null)
useHead({ title: () => `Builder · ${page.value?.title ?? 'Page'}` })

const { blocks, blocksList } = useCroutonLayoutBlocks()
const { payload: dragPayload, point: dragPoint, arm, onDrop: registerDrop, consumeClick } = useBoardDrag()

// ── The tree ───────────────────────────────────────────────────────────────────
const root = shallowRef<LayoutNode | null>(null)
const breakpoints = ref<LayoutBreakpoint[] | undefined>()
const dirty = ref(false)
const selected = ref<NodePath | null>(null)

function starterRoot(): LayoutNode {
  return {
    type: 'split',
    direction: 'horizontal',
    children: [
      { type: 'leaf', blockId: 'artists-list', config: { collection: 'builderArtists', heading: 'Artists', layout: 'list' } },
      { type: 'leaf', blockId: 'artists-form', config: { collection: 'builderArtists', heading: 'New artist' } },
    ],
  }
}

// ── Variants (#942): a page holds named layout variants; one is live. ─────────
interface BoardVariant { id: string, name: string, tree: LayoutTree }
const variants = ref<BoardVariant[]>([])
const liveId = ref<string>('a')
const currentId = ref<string>('a')
const current = computed(() => variants.value.find(v => v.id === currentId.value) ?? null)
const liveVariant = computed(() => variants.value.find(v => v.id === liveId.value) ?? null)

const nextName = () => String.fromCharCode(65 + (variants.value.length % 26))
const newId = () => Math.random().toString(36).slice(2, 8)

// Seed ONCE per page — never on a refetch, so a save can't re-seed the board.
// A board stored as `{ layout }` (pre-#942) wraps as variant "A"; `{ live, variants }` loads as is.
const loadedFor = ref<string | null>(null)
watch([page, pageId] as const, ([p, id]) => {
  if (!p || loadedFor.value === id) return
  const board = (p.board as Record<string, unknown> | null) ?? {}
  const storedVariants = Array.isArray(board.variants) ? board.variants as { id: string, name: string, layout: string }[] : null
  if (storedVariants?.length) {
    variants.value = storedVariants.map(v => ({ id: v.id, name: v.name, tree: parseLayoutTree(v.layout) ?? { renderer: 'panes', root: starterRoot() } }))
    liveId.value = typeof board.live === 'string' && variants.value.some(v => v.id === board.live) ? board.live : variants.value[0]!.id
  }
  else {
    const parsed = typeof board.layout === 'string' ? parseLayoutTree(board.layout) : null
    variants.value = [{ id: 'a', name: 'A', tree: parsed ?? { renderer: 'panes', root: starterRoot() } }]
    liveId.value = 'a'
  }
  showVariant(liveId.value)
  loadedFor.value = id
  dirty.value = false
}, { immediate: true })

// The board edits `root` in place; the current variant's tree is written back on
// every commit, so switching variants never loses an unsaved edit.
function showVariant(id: string) {
  const v = variants.value.find(x => x.id === id)
  if (!v) return
  currentId.value = id
  root.value = v.tree.root
  breakpoints.value = v.tree.breakpoints
  selected.value = null
}
function syncCurrent() {
  const v = current.value
  if (v) v.tree = { renderer: 'panes', root: root.value ?? starterRoot(), breakpoints: breakpoints.value }
}

function duplicateVariant() {
  const v = current.value
  if (!v) return
  syncCurrent()
  const copy: BoardVariant = { id: newId(), name: nextName(), tree: parseLayoutTree(serializeLayoutTree(v.tree)) ?? v.tree }
  variants.value = [...variants.value, copy]
  showVariant(copy.id)
  dirty.value = true
}
function setLive() {
  liveId.value = currentId.value
  dirty.value = true
}
function deleteVariant() {
  if (variants.value.length <= 1) return
  const id = currentId.value
  variants.value = variants.value.filter(v => v.id !== id)
  if (liveId.value === id) liveId.value = variants.value[0]!.id
  showVariant(liveId.value)
  dirty.value = true
}
const renaming = ref(false)
const renameDraft = ref('')
function startRename() {
  renameDraft.value = current.value?.name ?? ''
  renaming.value = true
}
function finishRename() {
  const v = current.value
  const name = renameDraft.value.trim()
  if (v && name && name !== v.name) { v.name = name; dirty.value = true }
  renaming.value = false
}

const variantMenu = computed(() => [
  variants.value.map(v => ({
    label: v.name,
    icon: v.id === liveId.value ? 'i-lucide-star' : (v.id === currentId.value ? 'i-lucide-check' : 'i-lucide-circle-dashed'),
    onSelect: () => showVariant(v.id),
  })),
  [
    { label: 'Duplicate', icon: 'i-lucide-copy', onSelect: duplicateVariant },
    { label: 'Rename', icon: 'i-lucide-pencil', onSelect: startRename },
    { label: 'Set as live', icon: 'i-lucide-star', disabled: currentId.value === liveId.value, onSelect: setLive },
    { label: 'Delete', icon: 'i-lucide-trash-2', color: 'error' as const, disabled: variants.value.length <= 1, onSelect: deleteVariant },
  ],
])

function commit(next: LayoutNode | null) {
  root.value = next
  dirty.value = true
  syncCurrent()
}

// ── Drops ──────────────────────────────────────────────────────────────────────
function newLeaf(blockId: string): LayoutLeaf {
  const def = blocks.value[blockId]
  const leaf = makeLeaf(blockId, def)
  return def?.defaultConfig ? { ...leaf, config: { ...def.defaultConfig } } : leaf
}

function onDrop(at: NodePath, edge: DropEdge, payload: BoardDragPayload) {
  if (!import.meta.client) return
  const r = root.value
  if (payload.kind === 'block') {
    if (!r) return commit(newLeaf(payload.blockId))
    // Centre on a leaf swaps the block; an edge lands beside (flattening into a
    // parallel split, wrapping otherwise).
    if (edge === 'center') return commit(dropBlock(r, at, payload.blockId, 'center', blocks.value[payload.blockId]))
    return commit(applyPaneDrop(r, { path: at, edge }, newLeaf(payload.blockId)))
  }
  // Moving a pane: remember the target by reference, lift the source out, find
  // the target again in the shrunk tree, then land beside or inside it.
  if (!r) return
  const target = getNode(r, at)
  if (!target) return
  const { root: lifted, detached } = detachNode(r, payload.path)
  if (!detached) return
  if (!lifted) return commit(detached)
  const targetPath = findNodePath(lifted, target)
  if (!targetPath) return
  if (edge === 'center') return commit(nestInside(lifted, targetPath, detached))
  commit(applyPaneDrop(lifted, { path: targetPath, edge }, detached))
}

function onResize(at: NodePath, sizes: number[]) {
  if (!root.value) return
  root.value = applySizes(root.value, at, sizes)
  dirty.value = true
  syncCurrent()
}

// ── Selection + the bottom sheet ──────────────────────────────────────────────
const sheetOpen = ref(false)
const selectedNode = computed(() => (selected.value && root.value ? getNode(root.value, selected.value) : null))
const selectedLeaf = computed(() => (selectedNode.value?.type === 'leaf' ? selectedNode.value : null))
const selectedDef = computed(() => (selectedLeaf.value ? blocks.value[selectedLeaf.value.blockId] : null))
const selectFields = computed(() => (selectedDef.value?.configSchema ?? []).filter(f => f.type === 'select' && f.options?.length))

function onSelect(at: NodePath) {
  selected.value = at
  sheetOpen.value = true
}
function setField(name: string, value: unknown) {
  if (!root.value || !selected.value || !selectedLeaf.value) return
  commit(setConfig(root.value, selected.value, { ...(selectedLeaf.value.config ?? {}), [name]: value }))
}
function removeSelected() {
  if (!root.value || !selected.value) return
  commit(removeNode(root.value, selected.value))
  selected.value = null
  sheetOpen.value = false
}

// The drag resolves its target itself; the page only supplies what a drop does.
registerDrop(onDrop)

// ── Palette strip: hold a chip, then drag it onto a pane edge ─────────────────
function onChipDown(e: PointerEvent, blockId: string) {
  arm(e, { kind: 'block', blockId, label: blocks.value[blockId]?.name ?? blockId }, { holdMs: 250 })
}
// A tap (pointer never activated a drag) still adds beside the selection.
function onChipClick(blockId: string) {
  if (consumeClick()) return
  tapAdd(blockId)
}
// Tap-to-add for one-handed use: lands beside the selected pane (or the root) —
// to the right on a wide screen, below on a phone, so columns don't get squeezed.
function tapAdd(blockId: string) {
  const r = root.value
  if (!r) return commit(newLeaf(blockId))
  const at = selected.value ?? []
  const edge: DropEdge = import.meta.client && window.innerWidth < 640 ? 'bottom' : 'right'
  commit(applyPaneDrop(r, { path: at, edge }, newLeaf(blockId)))
}

// ── Save ───────────────────────────────────────────────────────────────────────
const { update } = useCollectionMutation('builderPages')
const saveState = ref<'idle' | 'saving' | 'saved'>('idle')
async function saveBoard() {
  if (!root.value) return
  syncCurrent()
  saveState.value = 'saving'
  try {
    await update(pageId.value, {
      board: {
        live: liveId.value,
        variants: variants.value.map(v => ({ id: v.id, name: v.name, layout: serializeLayoutTree(v.tree) })),
        // Kept for anything still reading the single-layout shape: the LIVE variant.
        layout: serializeLayoutTree(liveVariant.value?.tree ?? { renderer: 'panes', root: root.value }),
      },
    })
    dirty.value = false
    saveState.value = 'saved'
  }
  catch {
    saveState.value = 'idle'
  }
}
</script>

<template>
  <div class="flex h-dvh flex-col bg-default">
    <!-- Header -->
    <header class="flex items-center gap-2 border-b border-default px-2 py-1.5">
      <UButton icon="i-lucide-arrow-left" color="neutral" variant="ghost" size="sm" to="/builder" aria-label="Back to site" />
      <span class="min-w-0 truncate text-sm font-medium" data-handoff="page-badge">{{ page?.title ?? 'Page' }}</span>
      <UInput
        v-if="renaming"
        v-model="renameDraft"
        size="xs"
        autofocus
        class="w-28"
        data-handoff="variant-rename"
        @keyup.enter="finishRename"
        @blur="finishRename"
      />
      <UDropdownMenu v-else :items="variantMenu" :content="{ align: 'start' }">
        <UButton
          color="neutral"
          variant="soft"
          size="xs"
          :icon="currentId === liveId ? 'i-lucide-star' : 'i-lucide-circle-dashed'"
          :label="current?.name ?? 'A'"
          trailing-icon="i-lucide-chevron-down"
          data-handoff="variant-switch"
        />
      </UDropdownMenu>
      <span class="flex-1" />
      <span v-if="saveState === 'saved' && !dirty" class="text-xs text-muted">Saved</span>
      <UButton
        icon="i-lucide-save"
        size="sm"
        :label="dirty ? 'Save' : 'Saved'"
        :loading="saveState === 'saving'"
        :disabled="!dirty && saveState !== 'saving'"
        data-handoff="board-save"
        @click="saveBoard"
      />
    </header>

    <!-- Palette strip: drag a chip onto a pane edge, or tap to add beside the selection. -->
    <nav class="flex gap-2 overflow-x-auto border-b border-default px-2 py-2" data-handoff="palette">
      <button
        v-for="b in blocksList"
        :key="b.id"
        type="button"
        class="board-chip flex shrink-0 items-center gap-1.5 rounded-full border border-default bg-elevated px-3 py-1.5 text-xs cursor-grab active:cursor-grabbing select-none"
        :data-block="b.id"
        @pointerdown="onChipDown($event, b.id)"
        @click="onChipClick(b.id)"
      >
        <UIcon :name="b.icon ?? 'i-lucide-box'" class="size-3.5" />
        {{ b.name }}
      </button>
    </nav>

    <!-- Board: the page, full-bleed at the real device width. -->
    <main class="relative min-h-0 flex-1" data-handoff="board">
      <BoardTree
        v-if="root"
        :node="root"
        :selected="selected"
        @resize="onResize"
        @select="onSelect"
      />
      <div
        v-else
        class="flex h-full items-center justify-center p-6 text-center text-sm text-muted"
        data-handoff="board-pane"
        data-path=""
      >
        Empty page — drag a block here, or tap one below.
      </div>
    </main>


    <!-- What you're carrying, following the finger. Not part of the tree. -->
    <div
      v-if="dragPayload && dragPoint"
      class="pointer-events-none fixed z-50 -translate-x-1/2 -translate-y-full rounded-full bg-primary px-3 py-1 text-xs font-medium text-inverted shadow-lg"
      :style="{ left: dragPoint.x + 'px', top: (dragPoint.y - 12) + 'px' }"
      data-handoff="drag-label"
    >
      {{ dragPayload.label }}
    </div>

    <!-- Bottom sheet: the selected pane's options. -->
    <UDrawer v-model:open="sheetOpen" :overlay="false" :modal="false" :handle="true">
      <template #content>
        <div class="space-y-4 p-4 pb-8">
          <div class="flex items-center gap-2">
            <UIcon :name="selectedDef?.icon ?? 'i-lucide-box'" class="size-4" />
            <span class="font-medium">{{ selectedDef?.name ?? selectedLeaf?.blockId ?? 'Pane' }}</span>
            <span v-if="selected" class="ml-auto text-xs text-muted">pane {{ selected.join('.') || 'root' }}</span>
          </div>
          <UFormField v-for="f in selectFields" :key="f.name" :label="f.label ?? f.name">
            <USelect
              :model-value="(selectedLeaf?.config?.[f.name] as string) ?? f.default"
              :items="f.options"
              class="w-full"
              @update:model-value="v => setField(f.name, v)"
            />
          </UFormField>
          <p v-if="selectedLeaf && !selectFields.length" class="text-sm text-muted">No options for this block.</p>
          <UButton v-if="selected" color="error" variant="soft" icon="i-lucide-trash-2" label="Remove from page" @click="removeSelected" />
        </div>
      </template>
    </UDrawer>
  </div>
</template>

<style scoped>
/* Chips scroll horizontally on a swipe; a held chip becomes a drag (pointer events). */
.board-chip { touch-action: pan-x; -webkit-touch-callout: none; }
</style>
