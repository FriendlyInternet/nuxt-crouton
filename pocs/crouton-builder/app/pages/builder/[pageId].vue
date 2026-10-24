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
const { dragging, start, end } = useBoardDrag()

// ── The tree ───────────────────────────────────────────────────────────────────
const root = shallowRef<LayoutNode | null>(null)
const breakpoints = ref<LayoutBreakpoint[] | undefined>()
const dirty = ref(false)

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

// Seed ONCE per page — never on a refetch, so a save can't re-seed the board.
const loadedFor = ref<string | null>(null)
watch([page, pageId] as const, ([p, id]) => {
  if (!p || loadedFor.value === id) return
  const stored = (p.board as Record<string, unknown> | null)?.layout
  const parsed = typeof stored === 'string' ? parseLayoutTree(stored) : null
  root.value = parsed?.root ?? starterRoot()
  breakpoints.value = parsed?.breakpoints
  loadedFor.value = id
  dirty.value = false
}, { immediate: true })

function commit(next: LayoutNode | null) {
  root.value = next
  dirty.value = true
}

// ── Drops ──────────────────────────────────────────────────────────────────────
function newLeaf(blockId: string): LayoutLeaf {
  const def = blocks.value[blockId]
  const leaf = makeLeaf(blockId, def)
  return def?.defaultConfig ? { ...leaf, config: { ...def.defaultConfig } } : leaf
}

function onDrop(at: NodePath, edge: DropEdge, payload: BoardDragPayload) {
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
}

// ── Selection + the bottom sheet ──────────────────────────────────────────────
const selected = ref<NodePath | null>(null)
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

// ── Palette strip: native drag sources ────────────────────────────────────────
function onChipDragStart(e: DragEvent, blockId: string) {
  start(e, { kind: 'block', blockId })
}
// Tap-to-add for one-handed use: lands to the right of the selected pane, or the root.
function tapAdd(blockId: string) {
  const r = root.value
  if (!r) return commit(newLeaf(blockId))
  const at = selected.value ?? []
  commit(applyPaneDrop(r, { path: at, edge: 'right' }, newLeaf(blockId)))
}

// ── Save ───────────────────────────────────────────────────────────────────────
const { update } = useCollectionMutation('builderPages')
const saveState = ref<'idle' | 'saving' | 'saved'>('idle')
async function saveBoard() {
  if (!root.value) return
  const tree: LayoutTree = { renderer: 'panes', root: root.value, breakpoints: breakpoints.value }
  saveState.value = 'saving'
  try {
    await update(pageId.value, { board: { layout: serializeLayoutTree(tree) } })
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
      <span class="min-w-0 flex-1 truncate text-sm font-medium" data-handoff="page-badge">{{ page?.title ?? 'Page' }}</span>
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
        class="flex shrink-0 items-center gap-1.5 rounded-full border border-default bg-elevated px-3 py-1.5 text-xs cursor-grab active:cursor-grabbing select-none"
        draggable="true"
        :data-block="b.id"
        @dragstart="onChipDragStart($event, b.id)"
        @dragend="end()"
        @click="tapAdd(b.id)"
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
        @drop="onDrop"
        @resize="onResize"
        @select="onSelect"
      />
      <div
        v-else
        class="flex h-full items-center justify-center p-6 text-center text-sm text-muted"
        @dragover.prevent
        @drop.prevent="dragging?.kind === 'block' && onDrop([], 'center', dragging)"
      >
        Empty page — drag a block here, or tap one below.
      </div>
    </main>


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
