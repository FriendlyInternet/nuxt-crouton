<script setup lang="ts">
/**
 * /builder/outline/[pageId] — the OUTLINE editor (spec: `outline-tree-editor`, proposed).
 *
 * SLICE 3 — structure as a DOM-tree outline (the "layout dependent" correction):
 *  · the page is a recursive tree shown as an INDENTED outline — child layouts (nested splits)
 *    are visible as indentation (spec: children layouts).
 *  · COLUMNS come from GROUPING, not a page-global switch: select sibling rows → "Group as
 *    columns / stack" wraps them into a child layout. Direction (⬌/⬍) is a per-GROUP dial.
 *  · drag a row handle to REORDER within its group.
 *  · RESPONSIVE is NOT reinvented here — a "Responsive" button opens the app's existing
 *    slider-based breakpoint author (CroutonLayoutBreakpointAuthor) bound to the same tree.
 *    (The previous device-bar/page-toggle was a cruder duplicate of that tool — removed.)
 *
 * Persists the whole tree to `builderPages.board.layout`. Deferred: horizontal drag-to-nest
 * (grouping already creates child layouts), cross-group reorder, retiring the canvas.
 */
import { computed, ref, watch } from 'vue'
import type { LayoutNode, LayoutTree } from '@fyit/crouton-core/app/types/layout'
import { serializeLayoutTree, parseLayoutTree } from '@fyit/crouton-layout/app/utils/layout-serialize'
import { moveChild } from '@fyit/crouton-layout/app/utils/layout-edit'
import type { BuilderPage } from '~~/layers/builder/collections/pages/types'

definePageMeta({ middleware: ['auth'] })

const route = useRoute()
const pageId = computed(() => String(route.params.pageId))
const { items: pages } = await useCollectionQuery('builderPages')
const page = computed(() => (pages.value as BuilderPage[]).find(p => p.id === pageId.value) ?? null)
useHead({ title: () => `Outline · ${page.value?.title ?? 'Page'}` })

// ── The page's whole layout tree. ────────────────────────────────────────────────
const tree = ref<LayoutTree>({ renderer: 'panes', root: starterRoot() })
const loadedFor = ref<string | null>(null)
const dirty = ref(false)
function starterRoot(): LayoutNode {
  return { type: 'split', direction: 'vertical', children: [
    { type: 'leaf', blockId: 'artists-list', config: { collection: 'builderArtists', heading: 'Artists', layout: 'list' } },
  ] }
}
watch([page, pageId] as const, ([p, id]) => {
  if (!p || loadedFor.value === id) return
  const stored = (p.board as Record<string, unknown> | null)?.layout
  tree.value = (typeof stored === 'string' ? parseLayoutTree(stored) : null) ?? { renderer: 'panes', root: starterRoot() }
  loadedFor.value = id
  selected.value = new Set()
}, { immediate: true })

const root = computed(() => tree.value.root)
function setRoot(next: LayoutNode) { tree.value = { ...tree.value, root: next }; dirty.value = true }

// ── Immutable path helpers (path = child indices from the root). ──────────────────
type Path = number[]
function getAt(node: LayoutNode, path: Path): LayoutNode | null {
  let n: LayoutNode | null = node
  for (const i of path) { if (!n || n.type !== 'split') return null; n = n.children[i] ?? null }
  return n
}
function setAt(node: LayoutNode, path: Path, next: LayoutNode): LayoutNode {
  if (!path.length) return next
  if (node.type !== 'split') return node
  const [i, ...rest] = path
  const kids = node.children.slice()
  kids[i!] = setAt(kids[i!]!, rest, next)
  return { ...node, children: kids }
}

// ── Flatten the tree into indented rows (child layouts = indentation). ────────────
const { getBlock } = useCroutonLayoutBlocks()
interface Row { node: LayoutNode, path: Path, depth: number, key: string, label: string, icon: string, sub: string | null, isGroup: boolean }
function metaFor(node: LayoutNode): { label: string, icon: string, sub: string | null, isGroup: boolean } {
  if (node.type === 'split') {
    const cols = node.direction === 'horizontal'
    return { label: cols ? 'Columns' : 'Stack', icon: cols ? 'i-lucide-columns-2' : 'i-lucide-rows-2', sub: `${node.children.length} items`, isGroup: true }
  }
  if (node.type === 'nested') return { label: node.label ?? 'Nested layout', icon: 'i-lucide-box', sub: 'child layout', isGroup: false }
  const b = getBlock(node.blockId)
  const cfg = node.config as { heading?: string } | undefined
  return { label: b?.name ?? node.blockId, icon: b?.icon ?? 'i-lucide-square', sub: cfg?.heading ?? null, isGroup: false }
}
const rows = computed<Row[]>(() => {
  const acc: Row[] = []
  const walk = (node: LayoutNode, path: Path, depth: number) => {
    acc.push({ node, path, depth, key: path.join('.') || 'root', ...metaFor(node) })
    if (node.type === 'split') node.children.forEach((c, i) => walk(c, [...path, i], depth + 1))
  }
  const r = root.value
  if (r.type === 'split') r.children.forEach((c, i) => walk(c, [i], 0))
  else walk(r, [], 0)
  return acc
})

// ── Selection (for grouping). Keys are path strings. ─────────────────────────────
const selected = ref<Set<string>>(new Set())
function toggleSelect(key: string) {
  const s = new Set(selected.value)
  s.has(key) ? s.delete(key) : s.add(key)
  selected.value = s
}
// Selected rows that are contiguous siblings under one parent → groupable.
const groupable = computed(() => {
  const picks = rows.value.filter(r => selected.value.has(r.key))
  if (picks.length < 2) return null
  const parent = picks[0]!.path.slice(0, -1).join('.')
  if (!picks.every(p => p.path.slice(0, -1).join('.') === parent)) return null
  const idxs = picks.map(p => p.path[p.path.length - 1]!).sort((a, b) => a - b)
  const contiguous = idxs.every((v, i) => i === 0 || v === idxs[i - 1]! + 1)
  return contiguous ? { parentPath: picks[0]!.path.slice(0, -1), from: idxs[0]!, to: idxs[idxs.length - 1]! } : null
})
const selectedGroup = computed(() => {
  const picks = rows.value.filter(r => selected.value.has(r.key))
  return picks.length === 1 && picks[0]!.isGroup ? picks[0]! : null
})

// ── Structure edits. ─────────────────────────────────────────────────────────────
function groupSelected(direction: 'horizontal' | 'vertical') {
  const g = groupable.value
  if (!g) return
  const parent = getAt(root.value, g.parentPath)
  if (parent?.type !== 'split') return
  const kids = parent.children
  const groupNode: LayoutNode = { type: 'split', direction, children: kids.slice(g.from, g.to + 1) }
  const nextParent: LayoutNode = { ...parent, children: [...kids.slice(0, g.from), groupNode, ...kids.slice(g.to + 1)] }
  setRoot(setAt(root.value, g.parentPath, nextParent))
  selected.value = new Set()
}
function ungroup(path: Path) {
  const grp = getAt(root.value, path)
  if (grp?.type !== 'split') return
  const parentPath = path.slice(0, -1)
  const idx = path[path.length - 1]!
  const parent = getAt(root.value, parentPath)
  if (parent?.type !== 'split') return
  const nextParent: LayoutNode = { ...parent, children: [...parent.children.slice(0, idx), ...grp.children, ...parent.children.slice(idx + 1)] }
  setRoot(setAt(root.value, parentPath, nextParent))
  selected.value = new Set()
}
function toggleDir(path: Path) {
  const g = getAt(root.value, path)
  if (g?.type !== 'split') return
  setRoot(setAt(root.value, path, { ...g, direction: g.direction === 'horizontal' ? 'vertical' : 'horizontal' }))
}
function removeAt(path: Path) {
  const parentPath = path.slice(0, -1)
  const idx = path[path.length - 1]!
  const parent = getAt(root.value, parentPath)
  if (parent?.type !== 'split') { setRoot(starterRoot()); return }
  const kids = parent.children.filter((_, i) => i !== idx)
  // a split with one survivor collapses up into it (keep the tree clean)
  const nextParent: LayoutNode = kids.length === 1 ? kids[0]! : { ...parent, children: kids }
  setRoot(parentPath.length ? setAt(root.value, parentPath, nextParent) : nextParent)
  selected.value = new Set()
}

// ── Add-from-list (appends at the root level). ───────────────────────────────────
const palette = [
  { blockId: 'artists-list', label: 'Artists · List', icon: 'i-lucide-list', collection: 'builderArtists', heading: 'Artists' },
  { blockId: 'artists-form', label: 'Artists · New', icon: 'i-lucide-square-pen', collection: 'builderArtists', heading: 'New artist' },
  { blockId: 'artists-stats', label: 'Artists · Stats', icon: 'i-lucide-gauge', collection: 'builderArtists', heading: 'Artists' },
  { blockId: 'bookings-list', label: 'Bookings · List', icon: 'i-lucide-list', collection: 'builderBookings', heading: 'Bookings' },
  { blockId: 'spacer', label: 'Spacer', icon: 'i-lucide-square-dashed' },
]
type PaletteItem = (typeof palette)[number]
function addBlock(item: PaletteItem) {
  const leaf: LayoutNode = { type: 'leaf', blockId: item.blockId, config: item.collection ? { collection: item.collection, heading: item.heading } : {} }
  const r = root.value
  setRoot(r.type === 'split' ? { ...r, children: [...r.children, leaf] } : { type: 'split', direction: 'vertical', children: [r, leaf] })
}

// ── Drag-to-reorder WITHIN a group (siblings only). ──────────────────────────────
const listEl = ref<HTMLElement | null>(null)
const dragKey = ref<string | null>(null)
const dropKey = ref<string | null>(null)
function onHandleDown(key: string, e: PointerEvent) {
  dragKey.value = key; dropKey.value = key
  ;(e.target as HTMLElement).setPointerCapture?.(e.pointerId)
  window.addEventListener('pointermove', onMove)
  window.addEventListener('pointerup', onUp, { once: true })
}
function onMove(e: PointerEvent) {
  const el = listEl.value
  if (!el || dragKey.value == null) return
  const dragRow = rows.value.find(r => r.key === dragKey.value)
  if (!dragRow) return
  const parent = dragRow.path.slice(0, -1).join('.')
  // Only siblings under the same parent are valid drop targets.
  const sibs = Array.from(el.querySelectorAll<HTMLElement>('[data-row]')).filter(n => {
    const k = n.getAttribute('data-key')!
    const rr = rows.value.find(r => r.key === k)
    return rr && rr.path.slice(0, -1).join('.') === parent
  })
  let target = dragKey.value
  for (const n of sibs) {
    const rect = n.getBoundingClientRect()
    if (e.clientY < rect.top + rect.height / 2) { target = n.getAttribute('data-key')!; break }
    target = n.getAttribute('data-key')!
  }
  dropKey.value = target
}
function onUp() {
  window.removeEventListener('pointermove', onMove)
  const dk = dragKey.value; const tk = dropKey.value
  dragKey.value = null; dropKey.value = null
  if (!dk || !tk || dk === tk) return
  const a = rows.value.find(r => r.key === dk); const b = rows.value.find(r => r.key === tk)
  if (!a || !b) return
  const parentPath = a.path.slice(0, -1)
  if (parentPath.join('.') !== b.path.slice(0, -1).join('.')) return
  const from = a.path[a.path.length - 1]!
  const to = b.path[b.path.length - 1]!
  const parent = getAt(root.value, parentPath)
  if (parent?.type !== 'split') return
  setRoot(setAt(root.value, parentPath, moveChild(parent, [], from, to)))
}

// ── Responsive: open the app's EXISTING slider-based breakpoint author. ──────────
const showResponsive = ref(false)

// ── Save. ────────────────────────────────────────────────────────────────────────
const { update } = useCollectionMutation('builderPages')
const saveState = ref<'idle' | 'saving' | 'saved'>('idle')
async function save() {
  saveState.value = 'saving'
  try { await update(pageId.value, { board: { layout: serializeLayoutTree(tree.value) } }); dirty.value = false; saveState.value = 'saved' }
  catch { saveState.value = 'idle' }
}
</script>

<template>
  <div class="flex h-[100dvh] flex-col bg-default text-default">
    <header class="flex items-center gap-2 border-b border-default px-3 py-2">
      <UButton icon="i-lucide-arrow-left" color="neutral" variant="ghost" size="sm" to="/builder" aria-label="Back to pages" />
      <div class="min-w-0 flex-1">
        <div class="truncate text-sm font-semibold">{{ page?.title ?? 'Page' }}</div>
        <div class="text-[11px] text-muted">Outline · <span class="text-primary">beta</span></div>
      </div>
      <UButton icon="i-lucide-ruler" color="neutral" variant="ghost" size="sm" data-handoff="open-responsive" @click="showResponsive = true">Responsive</UButton>
      <UButton
        :icon="dirty ? 'i-lucide-save' : 'i-lucide-check'"
        :color="dirty ? 'primary' : 'neutral'" :variant="dirty ? 'solid' : 'ghost'" size="sm"
        :loading="saveState === 'saving'" :disabled="!dirty && saveState !== 'saving'"
        @click="save"
      >{{ saveState === 'saved' && !dirty ? 'Saved' : 'Save' }}</UButton>
    </header>

    <div class="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-3 pb-24">
      <!-- the outline (indented tree = child layouts) -->
      <section>
        <div class="mb-1.5 px-1 text-[11px] font-semibold uppercase tracking-wide text-muted">Page outline</div>
        <div ref="listEl" data-handoff="outline-list" class="flex flex-col gap-1">
          <div
            v-for="row in rows"
            :key="row.key"
            data-row
            :data-key="row.key"
            data-handoff="outline-row"
            :data-group="row.isGroup ? 'true' : undefined"
            class="flex items-center gap-2 rounded-lg border px-2 py-2 transition"
            :class="[
              selected.has(row.key) ? 'border-primary bg-primary/10' : 'border-default bg-elevated/40',
              dragKey === row.key ? 'opacity-40' : '',
              dropKey === row.key && dragKey && dragKey !== row.key ? 'ring-1 ring-primary' : '',
            ]"
            :style="{ marginLeft: `${row.depth * 16}px` }"
            @click="toggleSelect(row.key)"
          >
            <div
              class="nodrag flex size-7 shrink-0 cursor-grab touch-none items-center justify-center rounded-md text-muted hover:bg-elevated"
              data-handoff="row-handle" aria-label="Drag to reorder"
              @click.stop @pointerdown="onHandleDown(row.key, $event)"
            >
              <UIcon name="i-lucide-grip-vertical" class="size-4" />
            </div>
            <UIcon :name="row.icon" class="size-4 shrink-0" :class="row.isGroup ? 'text-muted' : 'text-primary'" />
            <div class="min-w-0 flex-1">
              <div class="truncate text-sm font-medium">{{ row.label }}</div>
              <div v-if="row.sub" class="truncate text-[11px] text-muted">{{ row.sub }}</div>
            </div>
            <!-- per-GROUP direction (columns vs stack lives HERE, not page-global) -->
            <UButton
              v-if="row.isGroup"
              :icon="row.node.type === 'split' && row.node.direction === 'horizontal' ? 'i-lucide-columns-2' : 'i-lucide-rows-2'"
              color="neutral" variant="ghost" size="xs" data-handoff="group-direction"
              :title="row.node.type === 'split' && row.node.direction === 'horizontal' ? 'Columns — tap for stack' : 'Stack — tap for columns'"
              @click.stop="toggleDir(row.path)"
            />
            <UButton icon="i-lucide-trash-2" color="neutral" variant="ghost" size="xs" aria-label="Remove" @click.stop="removeAt(row.path)" />
          </div>
          <p v-if="!rows.length" class="rounded-lg border border-dashed border-default px-3 py-6 text-center text-sm text-muted">Empty page — add a block below.</p>
        </div>
        <p class="mt-1.5 px-1 text-[11px] text-muted">Tap rows to select, then group them. A group is a child layout — toggle its ⬌/⬍.</p>
      </section>

      <!-- add-from-list -->
      <section>
        <div class="mb-1.5 px-1 text-[11px] font-semibold uppercase tracking-wide text-muted">Add a block</div>
        <div class="flex flex-wrap gap-1.5" data-handoff="add-list">
          <UButton v-for="item in palette" :key="item.blockId" :icon="item.icon" color="neutral" variant="soft" size="sm" data-handoff="add-item" @click="addBlock(item)">{{ item.label }}</UButton>
        </div>
      </section>

      <!-- live preview (structure; per-width lives in the Responsive tool) -->
      <section class="min-h-0 flex-1">
        <div class="mb-1.5 px-1 text-[11px] font-semibold uppercase tracking-wide text-muted">Live preview</div>
        <div class="overflow-hidden rounded-xl border border-default bg-elevated/30" data-handoff="outline-preview">
          <CroutonLayoutRenderer :node="root" :interactive="false" />
        </div>
      </section>
    </div>

    <!-- grouping action bar (appears when a selection can be grouped / ungrouped) -->
    <div
      v-if="groupable || selectedGroup"
      class="absolute inset-x-0 bottom-0 flex items-center gap-2 border-t border-default bg-default/95 px-3 py-2.5 backdrop-blur"
      data-handoff="group-bar"
    >
      <template v-if="groupable">
        <span class="text-xs text-muted">Group as</span>
        <UButton icon="i-lucide-columns-2" size="sm" color="primary" data-handoff="group-columns" @click="groupSelected('horizontal')">Columns</UButton>
        <UButton icon="i-lucide-rows-2" size="sm" color="primary" variant="soft" data-handoff="group-stack" @click="groupSelected('vertical')">Stack</UButton>
      </template>
      <UButton v-if="selectedGroup" icon="i-lucide-ungroup" size="sm" color="neutral" variant="soft" data-handoff="ungroup" @click="ungroup(selectedGroup.path)">Ungroup</UButton>
      <UButton icon="i-lucide-x" size="sm" color="neutral" variant="ghost" class="ml-auto" aria-label="Clear selection" @click="selected = new Set()" />
    </div>

    <!-- responsive: the EXISTING slider-based breakpoint author, bound to the same tree -->
    <div v-if="showResponsive" class="absolute inset-0 z-50 flex flex-col bg-default" data-handoff="responsive-overlay">
      <div class="flex items-center gap-2 border-b border-default px-3 py-2">
        <div class="flex-1 text-sm font-semibold">Responsive · {{ page?.title }}</div>
        <UButton icon="i-lucide-check" color="primary" size="sm" data-handoff="responsive-done" @click="showResponsive = false; dirty = true">Done</UButton>
      </div>
      <div class="min-h-0 flex-1 overflow-y-auto">
        <CroutonLayoutBreakpointAuthor v-model="tree" />
      </div>
    </div>
  </div>
</template>
