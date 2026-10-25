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
import type { LayoutNode, LayoutTree, LayoutLeaf } from '@fyit/crouton-core/app/types/layout'
import { serializeLayoutTree, parseLayoutTree } from '@fyit/crouton-layout/app/utils/layout-serialize'
import {
  getNode, makeLeaf, dropBlock, dropNode, applyPaneDrop, detachNode, findNodePath,
  nestInside, applySizes, setConfig, removeNode,
  type NodePath, type DropEdge,
} from '@fyit/crouton-layout/app/utils/layout-edit'
import { resolveLayoutAtWidth, patchBreakpoint, removeBreakpoint } from '@fyit/crouton-layout/app/utils/layout-responsive'
import { setCollapseRecipe } from '@fyit/crouton-layout/app/utils/layout-edit'
import { isSubtreeCollapsed } from '@fyit/crouton-layout/app/utils/layout-responsive'
import { normalizeCollapseRecipe, LAYOUT_COLLAPSE_EDGES, type LayoutCollapseRecipe } from '@fyit/crouton-core/app/types/layout'
import { BOARD_HIDDEN_KEY, collectHidden, collapsePlacement, collapseReveal, type HiddenItem } from '~/utils/board-hidden'
import { useElementSize } from '@vueuse/core'
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

// ── Width: design at any size (#874 model) ────────────────────────────────────
// `frameWidth` null = fit the screen. Wider than the screen → the frame scales
// down to fit, so a desktop layout is visible (and editable) on a phone.
const boardEl = ref<HTMLElement | null>(null)
const { width: fitWidth, height: fitHeight } = useElementSize(boardEl)
const frameWidth = ref<number | null>(null)
const effWidth = computed(() => Math.round(frameWidth.value ?? fitWidth.value))
const scale = computed(() => (fitWidth.value && effWidth.value > fitWidth.value ? fitWidth.value / effWidth.value : 1))
const frameStyle = computed(() => ({
  width: `${effWidth.value}px`,
  height: `${fitHeight.value / scale.value}px`,
  transform: `scale(${scale.value})`,
  transformOrigin: 'top left',
}))
const WIDTH_PRESETS = [
  { label: 'Phone', width: 390, icon: 'i-lucide-smartphone' },
  { label: 'Tablet', width: 768, icon: 'i-lucide-tablet' },
  { label: 'Laptop', width: 1024, icon: 'i-lucide-laptop' },
  { label: 'Desktop', width: 1280, icon: 'i-lucide-monitor' },
]

// ── The tree, resolved at the current width ───────────────────────────────────
// The variant's tree holds the base root + authored breakpoints (min-width locks
// upward). What the board shows is the resolution at `effWidth`; what an edit
// writes is the breakpoint you are looking at — or a new one at an explicit width.
const tree = computed<LayoutTree | null>(() => current.value?.tree ?? null)
const resolved = computed(() => (tree.value && effWidth.value ? resolveLayoutAtWidth(tree.value, effWidth.value) : null))
const root = computed<LayoutNode | null>(() => resolved.value?.root ?? null)
const activeBp = computed<number | null>(() => resolved.value?.activeBreakpoint ?? null)
const breakpointList = computed(() => (tree.value?.breakpoints ?? []).map(b => b.minWidth))
// Where an edit lands: an explicit width with no checkpoint yet → a new one there.
const writeTarget = computed<number | null>(() => {
  if (frameWidth.value !== null) return effWidth.value
  return activeBp.value
})
const dirty = ref(false)
const selected = ref<NodePath | null>(null)

// ── Hidden blocks at this width → triggers (#2418) ────────────────────────────
const hiddenSet = computed(() => new Set(resolved.value?.collapsed ?? []))
const hiddenItems = computed<HiddenItem[]>(() => collectHidden(root.value, hiddenSet.value, id => ({
  label: blocks.value[id]?.name ?? id,
  icon: blocks.value[id]?.icon ?? 'i-lucide-box',
})))
const navItems = computed(() => hiddenItems.value.filter(i => collapsePlacement(i.recipe) === 'nav'))
const edgeItems = computed(() => hiddenItems.value.filter(i => collapsePlacement(i.recipe) === 'edge'))
const revealing = ref<HiddenItem | null>(null)
function openHidden(blockId: string) {
  revealing.value = hiddenItems.value.find(i => i.blockId === blockId) ?? null
}
provide(BOARD_HIDDEN_KEY, { navItems, items: hiddenItems, open: openHidden })
const revealKind = computed(() => (revealing.value ? collapseReveal(revealing.value.recipe) : null))
const revealSide = computed(() => {
  const e = revealing.value?.recipe.edge ?? 'right'
  return e === 'left' || e === 'right' ? e : 'bottom'
})

// Hide/show lives on a breakpoint: the one in view, or a new one at this width.
function toggleHiddenSelected() {
  if (selectedLeaf.value) toggleHiddenBlock(selectedLeaf.value.blockId)
}
function toggleHiddenBlock(blockId: string) {
  const v = current.value
  if (!v) return
  const leaf = { blockId }
  const w = writeTarget.value ?? effWidth.value
  const hasBp = (v.tree.breakpoints ?? []).some(b => b.minWidth === w)
  // A fresh breakpoint starts from what's hidden here now, so toggling one block
  // doesn't silently un-hide the others inherited from a lower checkpoint.
  let base = hasBp ? v.tree : patchBreakpoint(v.tree, w, { collapsed: [...hiddenSet.value] })
  // Hidden lists lock upward like everything else. A higher breakpoint that never
  // stated its own list is pinned to what it showed before this change, so hiding
  // a block on the phone can't leak into a desktop layout you already authored.
  for (const b of base.breakpoints ?? []) {
    if (b.minWidth > w && b.collapsed === undefined)
      base = patchBreakpoint(base, b.minWidth, { collapsed: resolveLayoutAtWidth(v.tree, b.minWidth).collapsed })
  }
  // Flip relative to what is SHOWN at this width (possibly inherited), not to the
  // breakpoint's own list — otherwise "show" on an inheriting breakpoint hides instead.
  const shown = new Set(hiddenSet.value)
  if (shown.has(leaf.blockId)) shown.delete(leaf.blockId)
  else shown.add(leaf.blockId)
  v.tree = patchBreakpoint(base, w, { collapsed: [...shown] })
  dirty.value = true
}
function setRecipe(patch: Partial<LayoutCollapseRecipe>) {
  const leaf = selectedLeaf.value
  if (!root.value || !leaf) return
  const next = normalizeCollapseRecipe({ ...normalizeCollapseRecipe(leaf.collapse), ...patch })
  writeRoot(setCollapseRecipe(root.value, leaf.blockId, next))
}
const selectedRecipe = computed(() => normalizeCollapseRecipe(selectedLeaf.value?.collapse))
const selectedHidden = computed(() => !!selectedLeaf.value && hiddenSet.value.has(selectedLeaf.value.blockId))
// Editing a hidden block's recipe from the list (it has no pane to tap any more).
function selectHidden(item: HiddenItem) {
  const path = findNodePath(root.value, item.leaf)
  selected.value = path
  sheetOpen.value = true
}
const allHidden = computed(() => !!root.value && isSubtreeCollapsed(root.value, hiddenSet.value))
const placementItems = [{ label: 'On its edge', value: 'edge' }, { label: 'In the nav', value: 'nav' }]
const edgeItemsOpts = LAYOUT_COLLAPSE_EDGES.map(e => ({ label: e[0]!.toUpperCase() + e.slice(1), value: e }))
const revealItems = [
  { label: 'Slideover', value: 'slideover' },
  { label: 'Bottom sheet', value: 'sheet' },
  { label: 'Modal', value: 'modal' },
  { label: 'Full page', value: 'page' },
]

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

function showVariant(id: string) {
  if (!variants.value.some(x => x.id === id)) return
  currentId.value = id
  selected.value = null
}
/** Write the edited arrangement into the current variant: the breakpoint in view, or the base. */
function writeRoot(next: LayoutNode | null) {
  const v = current.value
  if (!v) return
  const r = next ?? starterRoot()
  v.tree = writeTarget.value === null
    ? { ...v.tree, root: r }
    : patchBreakpoint(v.tree, writeTarget.value, { root: r })
  dirty.value = true
}
function resetBreakpoint() {
  const v = current.value
  if (!v || activeBp.value === null) return
  v.tree = removeBreakpoint(v.tree, activeBp.value)
  dirty.value = true
}

function duplicateVariant() {
  const v = current.value
  if (!v) return
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
  writeRoot(next)
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

// reka reports the group layout on mount and whenever its panels re-register, not
// only on a drag — so a report that changes nothing is ignored (it would otherwise
// dirty the board, and on a width/variant switch feed stale proportions into the
// breakpoint just switched to).
function onResize(at: NodePath, sizes: number[]) {
  const r = root.value
  if (!r) return
  const split = getNode(r, at)
  if (!split || split.type !== 'split') return
  const same = split.children.every((c, i) => Math.abs((c.defaultSize ?? 100 / split.children.length) - (sizes[i] ?? -1)) < 0.05)
  if (same) return
  writeRoot(applySizes(r, at, sizes))
}
// The splitters remount when the arrangement being edited changes, so they register
// their panels with the stored sizes instead of carrying the previous view's proportions.
const boardKey = computed(() => `${currentId.value}:${activeBp.value ?? 'base'}`)

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

// ── Width chip: drag sideways for any width, tap for presets ──────────────────
const widthLabel = computed(() => (frameWidth.value === null ? `Fit · ${effWidth.value}px` : `${effWidth.value}px`))
const widthMenu = computed(() => [
  [{ label: 'Fit the screen', icon: 'i-lucide-maximize', onSelect: () => { frameWidth.value = null } },
    ...WIDTH_PRESETS.map(p => ({ label: `${p.label} · ${p.width}`, icon: p.icon, onSelect: () => { frameWidth.value = p.width } }))],
  breakpointList.value.length
    ? breakpointList.value.map(w => ({ label: `≥ ${w}px · own layout`, icon: activeBp.value === w ? 'i-lucide-check' : 'i-lucide-ruler', onSelect: () => { frameWidth.value = w } }))
    : [{ label: 'No breakpoints yet — change something at a width to add one', disabled: true }],
  activeBp.value !== null
    ? [{ label: `Remove the ≥ ${activeBp.value}px layout`, icon: 'i-lucide-trash-2', color: 'error' as const, onSelect: resetBreakpoint }]
    : [],
])
let widthDrag: { startX: number, startW: number } | null = null
function onWidthDown(e: PointerEvent) {
  if (e.button !== 0) return
  widthDrag = { startX: e.clientX, startW: effWidth.value }
  const el = e.currentTarget as HTMLElement
  try { el.setPointerCapture(e.pointerId) }
  catch {}
  const move = (ev: PointerEvent) => {
    if (!widthDrag) return
    const dx = ev.clientX - widthDrag.startX
    if (Math.abs(dx) < 6 && frameWidth.value === null) return
    ev.preventDefault()
    let w = Math.max(320, Math.min(1600, widthDrag.startW + dx * 2))
    for (const p of WIDTH_PRESETS) if (Math.abs(w - p.width) < 10) w = p.width
    frameWidth.value = Math.round(w)
  }
  const up = () => {
    widthDrag = null
    window.removeEventListener('pointermove', move)
    window.removeEventListener('pointerup', up)
    window.removeEventListener('pointercancel', up)
  }
  window.addEventListener('pointermove', move)
  window.addEventListener('pointerup', up)
  window.addEventListener('pointercancel', up)
}

// ── Save ───────────────────────────────────────────────────────────────────────
const { update } = useCollectionMutation('builderPages')
const saveState = ref<'idle' | 'saving' | 'saved'>('idle')
async function saveBoard() {
  if (!root.value) return
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
      <UDropdownMenu :items="widthMenu" :content="{ align: 'start' }">
        <UButton
          color="neutral"
          variant="soft"
          size="xs"
          icon="i-lucide-move-horizontal"
          :label="widthLabel"
          class="touch-none select-none cursor-ew-resize"
          data-handoff="width-chip"
          @pointerdown="onWidthDown"
        />
      </UDropdownMenu>
      <UBadge v-if="activeBp !== null" color="primary" variant="subtle" size="xs" data-handoff="bp-badge">≥ {{ activeBp }}</UBadge>
      <UButton
        v-if="hiddenItems.length"
        size="xs"
        color="neutral"
        variant="soft"
        icon="i-lucide-eye-off"
        :label="String(hiddenItems.length)"
        aria-label="Hidden blocks"
        data-handoff="hidden-count"
        @click="sheetOpen = true"
      />
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
    <main ref="boardEl" class="relative min-h-0 flex-1 overflow-hidden" data-handoff="board">
      <div
        v-if="root && allHidden"
        class="flex h-full items-center justify-center p-6 text-center text-sm text-muted"
      >
        Everything on this page is hidden at this width — use the triggers, or tap the eye-off count to show blocks again.
      </div>
      <div
        v-else-if="root"
        class="board-frame"
        :class="{ 'board-frame--scaled': scale < 1 }"
        :style="frameStyle"
        :data-width="effWidth"
      >
        <BoardTree
          :key="boardKey"
          :node="root"
          :selected="selected"
          :hidden="hiddenSet"
          @resize="onResize"
          @select="onSelect"
        />
      </div>
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

    <!-- Edge triggers for hidden blocks placed on an edge (#2418). -->
    <div
      v-for="item in edgeItems"
      :key="item.blockId"
      class="edge-trigger pointer-events-auto fixed z-30"
      :data-edge="item.recipe.edge"
    >
      <UButton
        :icon="item.icon"
        :label="item.recipe.affordance === 'dot' ? undefined : item.label"
        size="xs"
        color="neutral"
        variant="solid"
        :data-edge-trigger="item.blockId"
        @click="openHidden(item.blockId)"
      />
    </div>

    <!-- The hidden block, opened the way its recipe says. -->
    <USlideover v-if="revealKind === 'slideover'" :open="!!revealing" :side="revealSide" :title="revealing?.label" @update:open="v => { if (!v) revealing = null }">
      <template #body><CroutonLayoutRenderer v-if="revealing" :node="revealing.leaf" :interactive="false" /></template>
    </USlideover>
    <UDrawer v-else-if="revealKind === 'sheet'" :open="!!revealing" :title="revealing?.label" @update:open="v => { if (!v) revealing = null }">
      <template #body><div class="max-h-[70dvh] overflow-auto"><CroutonLayoutRenderer v-if="revealing" :node="revealing.leaf" :interactive="false" /></div></template>
    </UDrawer>
    <UModal v-else-if="revealKind === 'modal' || revealKind === 'page'" :open="!!revealing" :title="revealing?.label" :fullscreen="revealKind === 'page'" @update:open="v => { if (!v) revealing = null }">
      <template #body><CroutonLayoutRenderer v-if="revealing" :node="revealing.leaf" :interactive="false" /></template>
    </UModal>

    <!-- Bottom sheet: the selected pane's options. -->
    <UDrawer v-model:open="sheetOpen" :overlay="false" :modal="false" :handle="true">
      <template #content>
        <div class="space-y-4 p-4 pb-24">
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
          <template v-if="selectedLeaf">
            <USeparator />
            <div class="flex items-center justify-between">
              <span class="text-sm">Hidden at this width</span>
              <USwitch :model-value="selectedHidden" data-handoff="hidden-toggle" @update:model-value="toggleHiddenSelected" />
            </div>
            <template v-if="selectedHidden">
              <UFormField label="Trigger">
                <USelect :model-value="collapsePlacement(selectedRecipe)" :items="placementItems" class="w-full" data-handoff="recipe-placement" @update:model-value="v => setRecipe({ placement: v as LayoutCollapseRecipe['placement'] })" />
              </UFormField>
              <UFormField v-if="collapsePlacement(selectedRecipe) === 'edge'" label="Edge">
                <USelect :model-value="selectedRecipe.edge" :items="edgeItemsOpts" class="w-full" @update:model-value="v => setRecipe({ edge: v as LayoutCollapseRecipe['edge'] })" />
              </UFormField>
              <UFormField label="Opens as">
                <USelect :model-value="collapseReveal(selectedRecipe)" :items="revealItems" class="w-full" data-handoff="recipe-reveal" @update:model-value="v => setRecipe({ reveal: v as LayoutCollapseRecipe['reveal'] })" />
              </UFormField>
            </template>
          </template>
          <UButton v-if="selected" color="error" variant="soft" icon="i-lucide-trash-2" label="Remove from page" @click="removeSelected" />
          <template v-if="hiddenItems.length">
            <USeparator />
            <p class="text-xs uppercase tracking-wide text-muted">Hidden at this width</p>
            <div v-for="item in hiddenItems" :key="item.blockId" class="flex items-center gap-2" :data-hidden-row="item.blockId">
              <UIcon :name="item.icon" class="size-4 shrink-0" />
              <span class="min-w-0 flex-1 truncate text-sm">{{ item.label }}</span>
              <span class="text-xs text-muted">{{ collapsePlacement(item.recipe) === 'nav' ? 'nav' : item.recipe.edge }} · {{ collapseReveal(item.recipe) }}</span>
              <UButton size="xs" color="neutral" variant="ghost" icon="i-lucide-settings-2" aria-label="Settings" @click="selectHidden(item)" />
              <UButton size="xs" color="neutral" variant="soft" icon="i-lucide-eye" label="Show" @click="toggleHiddenBlock(item.blockId)" />
            </div>
          </template>
        </div>
      </template>
    </UDrawer>
  </div>
</template>

<style scoped>
.edge-trigger[data-edge='right'] { right: 8px; top: 50%; transform: translateY(-50%); }
.edge-trigger[data-edge='left'] { left: 8px; top: 50%; transform: translateY(-50%); }
.edge-trigger[data-edge='top'] { top: 96px; left: 50%; transform: translateX(-50%); }
.edge-trigger[data-edge='bottom'] { bottom: 16px; left: 50%; transform: translateX(-50%); }
.board-frame { position: absolute; left: 0; top: 0; background: var(--ui-bg); }
.board-frame--scaled { outline: 1px solid var(--ui-border); box-shadow: 0 0 0 9999px color-mix(in oklch, var(--ui-bg-elevated) 70%, transparent); }
/* Chips scroll horizontally on a swipe; a held chip becomes a drag (pointer events). */
.board-chip { touch-action: pan-x; -webkit-touch-callout: none; }
</style>
