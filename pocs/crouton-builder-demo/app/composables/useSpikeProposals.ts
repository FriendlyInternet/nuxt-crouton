/**
 * Layout proposals (#908/#909) — ✨ Magic arrange (deterministic + optional AI tier) and the
 * positional "As placed"/"Compile snapped" paths, all feeding the SAME result slideover
 * (one shared LayoutTree model). Owns the slideover/palette open state and the proposal set
 * you flip between.
 */
import { computed, ref } from 'vue'
import type { Ref } from 'vue'
import type { LayoutTree } from '@fyit/crouton-core/app/types/layout'
import type { ComposePiece } from '@fyit/crouton-layout/app/composables/useCroutonComposeGestures'
import { piecesToTree } from '@fyit/crouton-layout/app/utils/layout-compose-bridge'
import { flattenLeaves, inferPositional } from '~/utils/spike-board'
import type { CanvasMode, FlowNode } from '~/utils/spike-board'

/** A layout the result slideover can render + let you flip between (magic or positional). */
export interface CanvasProposal { id: string, label: string, icon: string, note: string, tree: LayoutTree, viable: boolean }

export function useSpikeProposals(opts: { mode: Ref<CanvasMode>, pieces: Ref<ComposePiece[]>, nodes: Ref<FlowNode[]>, pushUndo: () => void }) {
  const { mode, pieces, nodes, pushUndo } = opts
  const { magicArrange, magicArrangeAI } = useSpikeMagic()
  const { checkViability } = useCroutonLayoutBlocks()

  // ✨ Magic v2 is an optional add-on: the AI button only shows when the crouton-ai package
  // is installed (same hasApp() stub pattern crouton-pages uses). No AI package → no button.
  const { hasApp } = useCroutonApps()
  const hasAI = hasApp('ai')
  const aiIntent = ref('')
  const aiLoading = ref(false)
  const resultSource = ref<'deterministic' | 'ai' | 'fallback'>('deterministic')

  // Mobile palette (bottom sheet) + the compiled-layout slideover open state.
  const paletteOpen = ref(false)
  const resultOpen = ref(false)

  /** The dropped blocks, from whichever surface is active (Free nodes / Snap pieces may
   *  each already be a merged group, so flatten their leaves). */
  function currentBlocks(): { blockId: string, label?: string }[] {
    return mode.value === 'snap'
      ? pieces.value.flatMap(p => flattenLeaves(p.node))
      : nodes.value.flatMap(n => flattenLeaves(n.data.node))
  }
  const blockCount = computed(() => currentBlocks().length)

  // The proposals the result slideover shows; you flip between them by id.
  const proposals = ref<CanvasProposal[]>([])
  const selectedId = ref<string>('')
  const resultTitle = ref('Layout')
  const selected = computed<CanvasProposal | null>(
    () => proposals.value.find(p => p.id === selectedId.value) ?? proposals.value[0] ?? null,
  )

  /** ✨ Magic v1 (#908) — deterministic arrange + viability-gated archetype proposals. */
  function magic() {
    const { proposals: ps, defaultId } = magicArrange(currentBlocks())
    proposals.value = ps
    selectedId.value = defaultId ?? ps[0]?.id ?? ''
    resultSource.value = 'deterministic'
    resultTitle.value = '✨ Magic layout'
    paletteOpen.value = false
    resultOpen.value = ps.length > 0
  }

  /** ✨ Magic v2 (#909) — AI proposes + ranks; deterministic composer is the viability guardrail. */
  async function magicAI() {
    if (aiLoading.value) return
    aiLoading.value = true
    try {
      const { proposals: ps, defaultId, source } = await magicArrangeAI(currentBlocks(), aiIntent.value)
      proposals.value = ps
      selectedId.value = defaultId ?? ps[0]?.id ?? ''
      resultSource.value = source === 'ai' ? 'ai' : 'fallback'
      resultTitle.value = source === 'ai' ? '✨ Magic layout · AI' : '✨ Magic layout'
      paletteOpen.value = false
      resultOpen.value = ps.length > 0
    }
    finally {
      aiLoading.value = false
    }
  }

  // Compile the current surface into a LayoutTree. Snap → the bound `piecesToTree` (#899);
  // Free → the positional infer. Both flow into the SAME slideover (one shared model).
  const compileLabel = computed(() => (mode.value === 'snap' ? 'Compile snapped' : 'As placed'))
  function compile() {
    const snap = mode.value === 'snap'
    const tree = snap
      ? (pieces.value.length ? piecesToTree(pieces.value) : null)
      : inferPositional(nodes.value)
    if (!tree) { proposals.value = []; return }
    proposals.value = [{
      id: 'positional',
      label: snap ? 'Snapped' : 'As placed',
      icon: snap ? 'i-lucide-magnet' : 'i-lucide-move',
      note: snap ? 'Your snapped arrangement' : 'Exactly where you dropped them',
      tree,
      viable: checkViability(tree, [1280, 768]).viable,
    }]
    selectedId.value = 'positional'
    resultTitle.value = snap ? 'Snapped layout' : 'Compiled layout'
    paletteOpen.value = false
    resultOpen.value = true
  }
  function reset() {
    if (nodes.value.length) pushUndo()
    nodes.value = []
    pieces.value = []
    proposals.value = []
    selectedId.value = ''
    resultOpen.value = false
  }

  return {
    hasAI, aiIntent, aiLoading, resultSource,
    paletteOpen, resultOpen,
    currentBlocks, blockCount,
    proposals, selectedId, resultTitle, selected,
    magic, magicAI, compile, compileLabel, reset,
  }
}
