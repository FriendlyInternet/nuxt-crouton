<script setup lang="ts">
/**
 * /builder/[pageId] — the PAGE BOARD, phone-first (#2375).
 *
 * The page's layout fills the screen as a splitter tree (BoardTree): drag a
 * pane edge to resize, drag a block chip onto a pane edge to add it, drag a
 * pane's grip onto another pane to move it, tap a pane for its options.
 *
 * This file is the shell: it owns the tree edits (drops, resize, config) and
 * Save. The rest is composed —
 *  · useBoardVariants  named arrangements per page, one live (#942)
 *  · useBoardWidth     design at any width; the frame scales to fit (#942)
 *  · useBoardHidden    blocks hidden at a width → triggers (#2418)
 *  · BoardSheet        the bottom sheet UI
 *  · BoardHiddenBlocks edge triggers + the reveal overlay (shared with /site)
 */
import type { LayoutNode, LayoutTree, LayoutLeaf } from '@fyit/crouton-core/app/types/layout'
import {
  getNode, makeLeaf, dropBlock, applyPaneDrop, detachNode, findNodePath,
  nestInside, applySizes, setConfig, removeNode,
  type NodePath, type DropEdge,
} from '@fyit/crouton-layout/app/utils/layout-edit'
import { resolveLayoutAtWidth, patchBreakpoint, removeBreakpoint } from '@fyit/crouton-layout/app/utils/layout-responsive'
import { BOARD_HIDDEN_KEY, isPaneHidden, type HiddenItem } from '~/utils/board-hidden'
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

const selected = ref<NodePath | null>(null)
const sheetOpen = ref(false)

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

// ── Variants + width ──────────────────────────────────────────────────────────
const {
  current, currentId, liveId, dirty, variantMenu, serializeBoard,
  renaming, renameDraft, finishRename,
} = useBoardVariants({ page, pageId, starterRoot, onSwitch: () => { selected.value = null } })

const boardEl = ref<HTMLElement | null>(null)
const { frameWidth, effWidth, scale, frameStyle, widthLabel, widthMenu: makeWidthMenu, onWidthDown } = useBoardWidth(boardEl)

// ── The tree, resolved at the current width ───────────────────────────────────
// The variant's tree holds the base root + authored breakpoints (min-width locks
// upward). The board shows the resolution at `effWidth`; an edit writes to the
// breakpoint in view — or creates one at an explicit width.
const tree = computed<LayoutTree | null>(() => current.value?.tree ?? null)
const resolved = computed(() => (tree.value && effWidth.value ? resolveLayoutAtWidth(tree.value, effWidth.value) : null))
const root = computed<LayoutNode | null>(() => resolved.value?.root ?? null)
const activeBp = computed<number | null>(() => resolved.value?.activeBreakpoint ?? null)
const breakpointList = computed(() => (tree.value?.breakpoints ?? []).map(b => b.minWidth))
const writeTarget = computed<number | null>(() => (frameWidth.value !== null ? effWidth.value : activeBp.value))

function setTree(next: LayoutTree) {
  if (!current.value) return
  current.value.tree = next
  dirty.value = true
}
function writeRoot(next: LayoutNode | null) {
  const t = tree.value
  if (!t) return
  const r = next ?? starterRoot()
  setTree(writeTarget.value === null ? { ...t, root: r } : patchBreakpoint(t, writeTarget.value, { root: r }))
}
function resetBreakpoint() {
  if (tree.value && activeBp.value !== null) setTree(removeBreakpoint(tree.value, activeBp.value))
}
const widthMenu = makeWidthMenu({ list: breakpointList, active: activeBp, remove: resetBreakpoint })
// The splitters remount when the arrangement being edited changes, so they register
// their panels with the stored sizes instead of carrying the previous view's proportions.
const boardKey = computed(() => `${currentId.value}:${activeBp.value ?? 'base'}`)

// ── Hidden blocks → triggers ──────────────────────────────────────────────────
const { hiddenSet, hiddenItems, navItems, allHidden, toggleHidden, setRecipe }
  = useBoardHidden({ tree, resolved, root, blocks, writeTarget, effWidth, setTree, writeRoot })
const hiddenLayer = ref<{ open: (id: string) => void } | null>(null)
provide(BOARD_HIDDEN_KEY, { navItems, items: hiddenItems, open: id => hiddenLayer.value?.open(id) })

// ── Selection ─────────────────────────────────────────────────────────────────
const selectedNode = computed(() => (selected.value && root.value ? getNode(root.value, selected.value) : null))
const selectedLeaf = computed<LayoutLeaf | null>(() => (selectedNode.value?.type === 'leaf' ? selectedNode.value : null))
const selectedDef = computed(() => (selectedLeaf.value ? blocks.value[selectedLeaf.value.blockId] ?? null : null))
const selectedHidden = computed(() => !!selectedLeaf.value && isPaneHidden(selectedLeaf.value, hiddenSet.value))

function onSelect(at: NodePath) {
  selected.value = at
  sheetOpen.value = true
}
// A hidden block has no pane to tap; the sheet's list selects it by its leaf.
function selectHidden(item: HiddenItem) {
  selected.value = findNodePath(root.value, item.leaf)
  sheetOpen.value = true
}
function setField(name: string, value: unknown) {
  if (!root.value || !selected.value || !selectedLeaf.value) return
  writeRoot(setConfig(root.value, selected.value, { ...(selectedLeaf.value.config ?? {}), [name]: value }))
}
function removeSelected() {
  if (!root.value || !selected.value) return
  writeRoot(removeNode(root.value, selected.value))
  selected.value = null
  sheetOpen.value = false
}

// ── Drops + resize ────────────────────────────────────────────────────────────
// Every new pane gets its own id (#2490) so it can be hidden apart from its twins.
function newLeaf(blockId: string): LayoutLeaf {
  const def = blocks.value[blockId]
  const leaf: LayoutLeaf = { ...makeLeaf(blockId, def), id: Math.random().toString(36).slice(2, 8) }
  return def?.defaultConfig ? { ...leaf, config: { ...def.defaultConfig } } : leaf
}

function onDrop(at: NodePath, edge: DropEdge, payload: BoardDragPayload) {
  const r = root.value
  if (payload.kind === 'block') {
    if (!r) return writeRoot(newLeaf(payload.blockId))
    // Centre on a leaf swaps the block; an edge lands beside (flattening into a
    // parallel split, wrapping otherwise).
    if (edge === 'center') return writeRoot(dropBlock(r, at, payload.blockId, 'center', blocks.value[payload.blockId]))
    return writeRoot(applyPaneDrop(r, { path: at, edge }, newLeaf(payload.blockId)))
  }
  // Moving a pane: remember the target by reference, lift the source out, find
  // the target again in the shrunk tree, then land beside or inside it.
  if (!r) return
  const target = getNode(r, at)
  if (!target) return
  const { root: lifted, detached } = detachNode(r, payload.path)
  if (!detached) return
  if (!lifted) return writeRoot(detached)
  const targetPath = findNodePath(lifted, target)
  if (!targetPath) return
  writeRoot(edge === 'center' ? nestInside(lifted, targetPath, detached) : applyPaneDrop(lifted, { path: targetPath, edge }, detached))
}
registerDrop(onDrop)

// reka reports the group layout on mount and whenever its panels re-register, not
// only on a drag — a report that changes nothing is ignored (it would otherwise
// dirty the board and, on a width/variant switch, feed stale proportions into the
// breakpoint just switched to).
function onResize(at: NodePath, sizes: number[]) {
  const r = root.value
  const split = r ? getNode(r, at) : null
  if (!r || !split || split.type !== 'split') return
  const same = split.children.every((c, i) => Math.abs((c.defaultSize ?? 100 / split.children.length) - (sizes[i] ?? -1)) < 0.05)
  if (!same) writeRoot(applySizes(r, at, sizes))
}

// ── Palette strip: hold a chip, then drag it onto a pane edge; a tap adds beside the selection ──
function onChipDown(e: PointerEvent, blockId: string) {
  arm(e, { kind: 'block', blockId, label: blocks.value[blockId]?.name ?? blockId }, { holdMs: 250 })
}
function onChipClick(blockId: string) {
  if (consumeClick()) return
  const r = root.value
  if (!r) return writeRoot(newLeaf(blockId))
  // Below on a phone so columns don't get squeezed; to the right on a wide screen.
  const edge: DropEdge = import.meta.client && window.innerWidth < 640 ? 'bottom' : 'right'
  writeRoot(applyPaneDrop(r, { path: selected.value ?? [], edge }, newLeaf(blockId)))
}

// ── Save ───────────────────────────────────────────────────────────────────────
const { update } = useCollectionMutation('builderPages')
const saveState = ref<'idle' | 'saving' | 'saved'>('idle')
async function saveBoard() {
  if (!root.value) return
  saveState.value = 'saving'
  try {
    await update(pageId.value, { board: serializeBoard(root.value) })
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
    <header class="flex items-center gap-2 border-b border-default px-2 py-1.5">
      <UButton icon="i-lucide-arrow-left" color="neutral" variant="ghost" size="sm" to="/builder" aria-label="Back to site" />
      <span class="min-w-0 truncate text-sm font-medium" data-handoff="page-badge">{{ page?.title ?? 'Page' }}</span>
      <UInput v-if="renaming" v-model="renameDraft" size="xs" autofocus class="w-28" data-handoff="variant-rename" @keyup.enter="finishRename" @blur="finishRename" />
      <UDropdownMenu v-else :items="variantMenu" :content="{ align: 'start' }">
        <UButton color="neutral" variant="soft" size="xs" :icon="currentId === liveId ? 'i-lucide-star' : 'i-lucide-circle-dashed'" :label="current?.name ?? 'A'" trailing-icon="i-lucide-chevron-down" data-handoff="variant-switch" />
      </UDropdownMenu>
      <UDropdownMenu :items="widthMenu" :content="{ align: 'start' }">
        <UButton color="neutral" variant="soft" size="xs" icon="i-lucide-move-horizontal" :label="widthLabel" class="touch-none select-none cursor-ew-resize" data-handoff="width-chip" @pointerdown="onWidthDown" />
      </UDropdownMenu>
      <UBadge v-if="activeBp !== null" color="primary" variant="subtle" size="xs" data-handoff="bp-badge">≥ {{ activeBp }}</UBadge>
      <UButton v-if="hiddenItems.length" size="xs" color="neutral" variant="soft" icon="i-lucide-eye-off" :label="String(hiddenItems.length)" aria-label="Hidden blocks" data-handoff="hidden-count" @click="sheetOpen = true" />
      <span class="flex-1" />
      <span v-if="saveState === 'saved' && !dirty" class="text-xs text-muted">Saved</span>
      <UButton icon="i-lucide-save" size="sm" :label="dirty ? 'Save' : 'Saved'" :loading="saveState === 'saving'" :disabled="!dirty && saveState !== 'saving'" data-handoff="board-save" @click="saveBoard" />
      <UButton icon="i-lucide-external-link" color="neutral" variant="ghost" size="sm" aria-label="View page" :to="page?.slug ? `/site/${page.slug}` : undefined" :disabled="!page?.slug" data-handoff="view-page" />
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

    <!-- Board: the page at the chosen width, scaled to fit when wider than the screen. -->
    <main ref="boardEl" class="relative min-h-0 flex-1 overflow-hidden" data-handoff="board">
      <div v-if="root && allHidden" class="flex h-full items-center justify-center p-6 text-center text-sm text-muted">
        Everything on this page is hidden at this width — use the triggers, or tap the eye-off count to show blocks again.
      </div>
      <div v-else-if="root" class="board-frame" :class="{ 'board-frame--scaled': scale < 1 }" :style="frameStyle" :data-width="effWidth">
        <BoardTree :key="boardKey" :node="root" :selected="selected" :hidden="hiddenSet" @resize="onResize" @select="onSelect" />
      </div>
      <div v-else class="flex h-full items-center justify-center p-6 text-center text-sm text-muted" data-handoff="board-pane" data-path="">
        Empty page — drag a block here, or tap one above.
      </div>
    </main>

    <!-- What you're carrying, following the finger. Not part of the tree. -->
    <div
      v-if="dragPayload && dragPoint"
      class="pointer-events-none fixed z-50 -translate-x-1/2 -translate-y-full rounded-full bg-primary px-3 py-1 text-xs font-medium text-inverted shadow-lg"
      :style="{ left: `${dragPoint.x}px`, top: `${dragPoint.y - 12}px` }"
      data-handoff="drag-label"
    >
      {{ dragPayload.label }}
    </div>

    <BoardHiddenBlocks ref="hiddenLayer" :items="hiddenItems" />

    <BoardSheet
      v-model:open="sheetOpen"
      :selected="selected"
      :leaf="selectedLeaf"
      :def="selectedDef"
      :hidden="selectedHidden"
      :hidden-items="hiddenItems"
      @set-field="setField"
      @toggle-hidden="toggleHidden"
      @set-recipe="setRecipe"
      @remove="removeSelected"
      @select-hidden="selectHidden"
    />
  </div>
</template>

<style scoped>
.board-frame { position: absolute; left: 0; top: 0; background: var(--ui-bg); }
.board-frame--scaled { outline: 1px solid var(--ui-border); box-shadow: 0 0 0 9999px color-mix(in oklch, var(--ui-bg-elevated) 70%, transparent); }
/* Chips scroll horizontally on a swipe; a held chip becomes a drag (pointer events). */
.board-chip { touch-action: pan-x; -webkit-touch-callout: none; }
</style>
