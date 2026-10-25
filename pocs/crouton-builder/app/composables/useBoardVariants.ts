/**
 * Named layout variants per page (#942): a page holds several arrangements,
 * one of them live. Loads them from the page's `board` JSON (wrapping the
 * older `{ layout }` shape as variant "A"), owns the switcher menu, and
 * produces the `board` payload Save writes.
 */
import type { Ref } from 'vue'
import type { LayoutNode, LayoutTree } from '@fyit/crouton-core/app/types/layout'
import { serializeLayoutTree, parseLayoutTree } from '@fyit/crouton-layout/app/utils/layout-serialize'

export interface BoardVariant { id: string, name: string, tree: LayoutTree }

export function useBoardVariants(opts: {
  page: Ref<{ board?: unknown } | null>
  pageId: Ref<string>
  starterRoot: () => LayoutNode
  /** Called when the shown variant changes (the host clears its selection). */
  onSwitch?: () => void
}) {
  const variants = ref<BoardVariant[]>([])
  const liveId = ref('a')
  const currentId = ref('a')
  const dirty = ref(false)
  const current = computed(() => variants.value.find(v => v.id === currentId.value) ?? null)
  const liveVariant = computed(() => variants.value.find(v => v.id === liveId.value) ?? null)

  const nextName = () => String.fromCharCode(65 + (variants.value.length % 26))
  const newId = () => Math.random().toString(36).slice(2, 8)
  const starterTree = (): LayoutTree => ({ renderer: 'panes', root: opts.starterRoot() })

  function showVariant(id: string) {
    if (!variants.value.some(x => x.id === id)) return
    currentId.value = id
    opts.onSwitch?.()
  }

  // Seed ONCE per page — never on a refetch, so a save can't re-seed the board.
  const loadedFor = ref<string | null>(null)
  watch([opts.page, opts.pageId] as const, ([p, id]) => {
    if (!p || loadedFor.value === id) return
    const board = (p.board as Record<string, unknown> | null) ?? {}
    const stored = Array.isArray(board.variants) ? board.variants as { id: string, name: string, layout: string }[] : null
    if (stored?.length) {
      variants.value = stored.map(v => ({ id: v.id, name: v.name, tree: parseLayoutTree(v.layout) ?? starterTree() }))
      liveId.value = typeof board.live === 'string' && variants.value.some(v => v.id === board.live) ? board.live : variants.value[0]!.id
    }
    else {
      const parsed = typeof board.layout === 'string' ? parseLayoutTree(board.layout) : null
      variants.value = [{ id: 'a', name: 'A', tree: parsed ?? starterTree() }]
      liveId.value = 'a'
    }
    showVariant(liveId.value)
    loadedFor.value = id
    dirty.value = false
  }, { immediate: true })

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
    if (v && name && name !== v.name) {
      v.name = name
      dirty.value = true
    }
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

  /** The `board` payload: every variant, plus `layout` = the live one for older readers. */
  function serializeBoard(fallbackRoot: LayoutNode) {
    return {
      live: liveId.value,
      variants: variants.value.map(v => ({ id: v.id, name: v.name, layout: serializeLayoutTree(v.tree) })),
      layout: serializeLayoutTree(liveVariant.value?.tree ?? { renderer: 'panes', root: fallbackRoot }),
    }
  }

  return {
    variants, liveId, currentId, current, liveVariant, dirty,
    showVariant, duplicateVariant, setLive, deleteVariant,
    renaming, renameDraft, startRename, finishRename,
    variantMenu, serializeBoard,
  }
}
