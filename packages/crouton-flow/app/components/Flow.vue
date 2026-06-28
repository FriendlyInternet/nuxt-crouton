<script setup lang="ts">
import { computed, nextTick, provide, reactive, ref, resolveComponent, watch, markRaw } from 'vue'
import type { Component } from 'vue'
import { useThrottleFn } from '@vueuse/core'
import { VueFlow, useVueFlow, ConnectionMode } from '@vue-flow/core'
import { Background } from '@vue-flow/background'
import { Controls } from '@vue-flow/controls'
import { MiniMap } from '@vue-flow/minimap'
import type { Node, GraphNode, NodeDragEvent, OnConnectStartParams, Connection } from '@vue-flow/core'
import type { FlowConfig, FlowPosition, FlowDataMode, NodeTypeRegistration, FlowContainerOptions } from '../types/flow'
import { useFlowData } from '../composables/useFlowData'
import { useFlowLayout } from '../composables/useFlowLayout'
import { useDebouncedPositionUpdate } from '../composables/useFlowMutation'
import { useFlowPositionStore } from '../composables/useFlowPositionStore'
import { useFlowPositionSync } from '../composables/useFlowPositionSync'
import { useFlowSync } from '../composables/useFlowSync'
import { useFlowDragDrop } from '../composables/useFlowDragDrop'
import { useFlowSyncBridge } from '../composables/useFlowSyncBridge'
import { useFlowContainerDetection, type ContainerChangeEvent } from '../composables/useFlowContainerDetection'
import CroutonFlowNode from './Node.vue'
import CroutonFlowGhostNode from './GhostNode.vue'

// Import default styles
import '@vue-flow/core/dist/style.css'
import '@vue-flow/core/dist/theme-default.css'
import '@vue-flow/controls/dist/style.css'
import '@vue-flow/minimap/dist/style.css'

// Note: nodeTypes is built dynamically below after props are defined

/**
 * CroutonFlow - Main Vue Flow wrapper component
 *
 * Renders collection data as an interactive node graph with:
 * - Automatic dagre layout for tree/DAG structures
 * - Drag-and-drop node positioning with persistence
 * - Custom node component resolution
 * - Parent-based edge generation
 * - Real-time multiplayer sync (when sync mode enabled)
 *
 * @example
 * ```vue
 * <!-- Without sync (existing behavior) -->
 * <CroutonFlow
 *   :rows="decisions"
 *   collection="decisions"
 *   parent-field="parentId"
 *   position-field="position"
 * />
 *
 * <!-- With sync (multiplayer mode) -->
 * <CroutonFlow
 *   collection="decisions"
 *   sync
 *   :flow-id="projectId"
 * />
 * ```
 */

interface Props {
  /**
   * Collection rows to display as nodes (not needed when sync=true).
   * In ephemeral mode (data-mode="ephemeral") these are pre-built Vue Flow
   * Node[] rather than raw collection rows — hence the union. The component
   * consumes them as records internally (see the cast at the ephemeral branch).
   * Widened so consumers can v-model:rows a typed Node[] ref without TS2322 (#233).
   */
  rows?: Record<string, unknown>[] | Node[]
  /** Collection name for component resolution and mutations */
  collection: string
  /** Field containing parent ID (default: 'parentId') */
  parentField?: string
  /** Field containing position { x, y } (default: 'position') */
  positionField?: string
  /** Field to use as label (default: 'title') */
  labelField?: string
  /** Flow configuration */
  flowConfig?: FlowConfig
  /** Whether to show controls (default: true) */
  controls?: boolean
  /** Whether to show minimap (default: false) */
  minimap?: boolean
  /** Whether to show background (default: true) */
  background?: boolean
  /** Background pattern (default: 'dots') */
  backgroundPattern?: 'dots' | 'lines'
  /** Whether nodes are draggable (default: true) */
  draggable?: boolean
  /** Whether to fit view on mount (default: true) */
  fitViewOnMount?: boolean
  /** Enable real-time sync mode */
  sync?: boolean
  /** Flow ID for sync mode (required if sync=true) */
  flowId?: string
  /** Allow items to be dropped onto the flow (default: false) */
  allowDrop?: boolean
  /** Collections allowed to be dropped (empty = all allowed) */
  allowedCollections?: string[]
  /** Whether to auto-create nodes when items are dropped (default: true in sync mode) */
  autoCreateOnDrop?: boolean
  /** Custom node type components (key = node type string, value = component + isContainer flag) */
  nodeTypeComponents?: Record<string, NodeTypeRegistration>
  /** Container detection options — enable card-over-group overlap detection on drag stop */
  containerOptions?: FlowContainerOptions
  /** Data mode: 'collection' (default) or 'ephemeral' (skip collection mutations) */
  dataMode?: FlowDataMode
  /** Pre-loaded node positions from flow_configs (avoids extra fetch) */
  savedPositions?: Record<string, { x: number; y: number }> | null
  /** Selected node IDs (enables v-model:selected) */
  selected?: string[]
  /** Additional edges to render alongside parent-derived edges */
  additionalEdges?: Array<{ id: string; source: string; target: string }>
  /** Color for background dot/line pattern (default: '#aaa') */
  backgroundPatternColor?: string
  /**
   * Explicit component for the default node render path. When set it overrides
   * the by-collection-name resolution (`{Collection}Node`) — the only way a
   * wrapper in this prefixed package (e.g. CroutonFlowSiteFlow's page card) can
   * inject its own node card, since the `CroutonFlow` component prefix makes the
   * by-name lookup unreachable. Ghost nodes still render as ghosts.
   */
  defaultNodeComponent?: Component
  /**
   * Camera focus: a rectangle (flow coords) to frame — set it to zoom the canvas onto that area
   * (e.g. a node the host is rendering at a specific size), clear it (null/undefined) to fit the
   * whole board. Deterministic (fitBounds) — pass the rect the focused node WILL occupy and the
   * camera frames it without waiting for Vue Flow to re-measure. View transform only.
   */
  focusBounds?: { x: number, y: number, width: number, height: number } | null
}

const props = withDefaults(defineProps<Props>(), {
  parentField: 'parentId',
  positionField: 'position',
  labelField: 'title',
  controls: true,
  minimap: false,
  background: true,
  backgroundPattern: 'dots',
  draggable: true,
  fitViewOnMount: true,
  sync: false,
  allowDrop: false,
  allowedCollections: () => [],
  autoCreateOnDrop: true,
  dataMode: 'collection',
})

const emit = defineEmits<{
  /** Emitted when a node is clicked (Vue Flow forwards mouse or touch events) */
  nodeClick: [nodeId: string, data: Record<string, unknown>, event: MouseEvent | TouchEvent]
  /** Emitted when a node is double-clicked */
  nodeDblClick: [nodeId: string, data: Record<string, unknown>]
  /** Emitted when a node position changes (after drag) */
  nodeMove: [nodeId: string, position: FlowPosition]
  /** Emitted continuously WHILE a node is dragged (live position, throttled ~50ms) — for live snap guides / alignment previews */
  nodeDrag: [nodeId: string, position: FlowPosition]
  /** Emitted when an edge is clicked */
  edgeClick: [edgeId: string]
  /** Emitted when selection changes */
  selectionChange: [selectedNodeIds: string[]]
  /** Emitted when an item is dropped onto the flow */
  nodeDrop: [item: Record<string, unknown>, position: FlowPosition, collection: string]
  /** Emitted when a node's container assignment changes (drag into/out of group) */
  nodeContainerChange: [event: ContainerChangeEvent]
  /** Emitted when nodes are deleted (keyboard delete or programmatic removal) */
  nodeDelete: [nodeIds: string[]]
  /** Emitted when a connection drag ends without connecting to a target handle */
  connectEnd: [event: { sourceNodeId: string; sourceHandleType: string; position: FlowPosition; mouseEvent: MouseEvent }]
  /** Emitted in ephemeral mode when nodes change (enables v-model:rows) */
  'update:rows': [rows: Record<string, unknown>[]]
  /** Emitted when selection changes (enables v-model:selected) */
  'update:selected': [selectedNodeIds: string[]]
  /** Emitted when a node is unlocked (position lock removed) */
  nodeUnlock: [nodeId: string]
}>()

// Validate props
if (props.sync && !props.flowId) {
  console.warn('[CroutonFlow] flowId is required when sync mode is enabled')
}

// Container ref for drag-leave detection
const containerRef = ref<HTMLElement | null>(null)

// Dark mode detection - useColorMode is auto-imported by Nuxt
const colorMode = useColorMode()
const isDark = computed(() => colorMode.value === 'dark')

// ============================================
// SYNC MODE: Initialize real-time sync
// ============================================
// Full sync: stores all node data in Yjs (collection mode)
// Position sync: only positions in Yjs (ephemeral mode)
const syncState = (props.sync && props.flowId && props.dataMode !== 'ephemeral')
  ? useFlowSync({
      flowId: props.flowId,
      collection: props.collection
    })
  : null

const positionSync = (props.sync && props.flowId && props.dataMode === 'ephemeral')
  ? useFlowPositionSync({ flowId: props.flowId })
  : null

// ============================================
// DYNAMIC NODE TYPES
// ============================================
// Merge built-in ghost type with user-provided node type components
const nodeTypes = computed(() => {
  const types: Record<string, any> = {
    ghost: markRaw(CroutonFlowGhostNode),
  }
  if (props.nodeTypeComponents) {
    for (const [typeName, reg] of Object.entries(props.nodeTypeComponents)) {
      types[typeName] = markRaw(reg.component)
    }
  }
  return types
})

// ============================================
// CONTAINER DETECTION
// ============================================
const containerDetection = props.containerOptions?.enabled && props.nodeTypeComponents
  ? useFlowContainerDetection({ nodeTypeComponents: props.nodeTypeComponents })
  : null

// ============================================
// VUEFLOW INSTANCE
// ============================================
const {
  onNodeDrag,
  onNodeDragStop,
  onNodeClick,
  onNodeDoubleClick,
  onEdgeClick,
  onEdgeDoubleClick,
  onNodesChange,
  onEdgesChange,
  onConnect,
  onConnectStart,
  onConnectEnd,
  getSelectedEdges,
  screenToFlowCoordinate,
  getSelectedNodes,
  addSelectedNodes,
  removeSelectedNodes,
  findNode,
  fitView,
  fitBounds,
  setCenter
} = useVueFlow()

// Camera focus driven by `focusBounds`: the host hands us the EXACT rectangle (flow coords) the
// focused node occupies — its position + the size it's rendered at. Rather than auto-fit (which
// would shrink a wider device to tiny), we set an explicit zoom that maps the device WIDTH to a
// CONSTANT fraction of the canvas width — so scrubbing to a bigger screen zooms OUT and the layout
// stays ~the same on-screen size, only reflowing for the new width (the responsive-preview feel).
// Deterministic (no Vue Flow re-measure). Clear → fit the whole board, capped.
watch(() => props.focusBounds, (bounds) => {
  if (bounds) {
    // Defer past the same-tick node-set/resize churn (soloing a node makes Vue Flow re-process
    // nodes and can fire its own viewport fit that races ours) so our fit is the last camera op.
    const apply = () => fitBounds({ ...bounds }, { duration: 250, padding: 0.18 })
    if (typeof requestAnimationFrame !== 'undefined') requestAnimationFrame(() => requestAnimationFrame(apply))
    else apply()
  }
  else nextTick(() => fitView({ duration: 450, padding: 0.3, maxZoom: 1 }))
}, { deep: true })

// Flag to prevent emit loops when syncing selected prop to Vue Flow
const isSyncingFromProp = ref(false)

// Detect node removals (keyboard delete) and emit nodeDelete
// Also detect selection changes and emit update:selected
onNodesChange((changes) => {
  const removedIds = changes
    .filter((c) => c.type === 'remove')
    .map((c) => c.id)
  if (removedIds.length > 0) {
    // Clean up position cache for removed nodes
    for (const id of removedIds) positionCache.delete(id)
    emit('nodeDelete', removedIds)
  }

  // Detect selection changes and emit update:selected
  // Skip emitting when we're syncing from the selected prop to avoid loops
  const hasSelectionChange = changes.some((c) => c.type === 'select')
  if (hasSelectionChange && !isSyncingFromProp.value) {
    const selectedIds = getSelectedNodes.value.map((n) => n.id)
    emit('update:selected', selectedIds)
    emit('selectionChange', selectedIds)
  }
})

// Watch the selected prop and sync to Vue Flow when parent changes it externally
watch(() => props.selected, (newSelected) => {
  if (!newSelected) return
  isSyncingFromProp.value = true

  const currentSelectedIds = new Set(getSelectedNodes.value.map((n) => n.id))
  const targetSelectedIds = new Set(newSelected)

  // Remove nodes that should no longer be selected
  const toDeselect = getSelectedNodes.value.filter((n) => !targetSelectedIds.has(n.id))
  if (toDeselect.length > 0) {
    removeSelectedNodes(toDeselect)
  }

  // Add nodes that should be selected but aren't yet
  const toSelect = newSelected
    .filter((id) => !currentSelectedIds.has(id))
    .map((id) => findNode(id))
    .filter(Boolean) as GraphNode[]
  if (toSelect.length > 0) {
    addSelectedNodes(toSelect)
  }

  nextTick(() => { isSyncingFromProp.value = false })
}, { deep: true })

// ============================================
// CONNECTION DRAG (connector to empty space)
// ============================================
const pendingConnection = ref<{ nodeId: string; handleType: string } | null>(null)
let connectionCompleted = false

// Connection persistence — PATCH target node via collection API
async function patchNode(nodeId: string, body: Record<string, unknown>) {
  try {
    const collections = useCollections()
    const config = collections.getConfig(props.collection)
    if (!config) return

    const apiPath = config.apiPath || props.collection
    const { getTeamId } = useTeamContext()
    const route = useRoute()
    let basePath: string
    if (route.path.includes('/super-admin/')) {
      basePath = `/api/super-admin/${apiPath}`
    } else {
      const teamId = getTeamId()
      if (!teamId) return
      basePath = `/api/teams/${teamId}/${apiPath}`
    }

    await $fetch(`${basePath}/${nodeId}`, {
      method: 'PATCH',
      body,
      credentials: 'include',
    })
  } catch (e) {
    console.error('[CroutonFlow] patchNode FAILED', nodeId, body, e)
  }
}

// Native pointer events to detect connection drag start/end
// Vue Flow's connect-start/end events don't fire through <ClientOnly>
watch(containerRef, (container) => {
  if (!container) return

  container.addEventListener('pointerdown', (e: PointerEvent) => {
    const handle = (e.target as HTMLElement)?.closest('.vue-flow__handle')
    if (!handle) return
    const nodeEl = handle.closest('.vue-flow__node')
    const nodeId = nodeEl?.getAttribute('data-id')
    const handleType = handle.classList.contains('source') ? 'source' : 'target'
    if (nodeId) {
      pendingConnection.value = { nodeId, handleType }
      connectionCompleted = false
    }
  }, { capture: true })

  document.addEventListener('pointerup', (e: PointerEvent) => {
    if (!pendingConnection.value || connectionCompleted) {
      pendingConnection.value = null
      return
    }

    const targetHandle = (e.target as HTMLElement)?.closest('.vue-flow__handle')
    if (targetHandle) {
      pendingConnection.value = null
      return
    }

    const flowPosition = screenToFlowCoordinate({ x: e.clientX, y: e.clientY })
    emit('connectEnd', {
      sourceNodeId: pendingConnection.value.nodeId,
      sourceHandleType: pendingConnection.value.handleType,
      position: { x: Math.round(flowPosition.x), y: Math.round(flowPosition.y) },
      mouseEvent: e as unknown as MouseEvent,
    })

    pendingConnection.value = null
  })
})



// Handle new connection from @connect on VueFlow template
function onNewConnection(connection: Connection) {
  connectionCompleted = true

  if (!connection.source || !connection.target) return

  // Add edge to v-model ref
  finalEdges.value = [...finalEdges.value, {
    id: `e-${connection.source}-${connection.target}`,
    source: connection.source,
    target: connection.target,
  }]

  // Persist to DB
  const targetRow = rowsRef.value.find(r => (r as any).id === connection.target)
  const existingParent = targetRow?.[props.parentField] as string | null | undefined

  if (existingParent && existingParent !== connection.source) {
    // Fan-in: target already has a parent
    const existing = Array.isArray((targetRow as any)?.contextNodeIds) ? [...(targetRow as any).contextNodeIds] : []
    if (!existing.includes(existingParent)) existing.push(existingParent)
    if (!existing.includes(connection.source)) existing.push(connection.source)
    patchNode(connection.target, {
      [props.parentField]: connection.source,
      contextScope: 'manual',
      contextNodeIds: existing,
    })
  } else {
    patchNode(connection.target, { [props.parentField]: connection.source })
  }
}

// Keep onConnect hook for connectEnd logic (tracks connectionCompleted flag)
onConnect(() => {
  connectionCompleted = true
})


// ============================================
// DRAG & DROP (external items onto canvas)
// ============================================
const {
  isDragOver,
  localGhostNode,
  handleDragOver,
  handleDragLeave,
  handleDrop,
  stopGhostCleanup
} = useFlowDragDrop(props, {
  syncState,
  containerRef,
  screenToFlowCoordinate,
  onDrop: (item, position, collection) => emit('nodeDrop', item, position, collection)
})

// ============================================
// SYNC BRIDGE (Yjs ↔ Vue Flow conversion)
// ============================================
const {
  syncNodes,
  syncEdges,
  otherUsersInRoom,
  remoteGhostNodes
} = useFlowSyncBridge({
  syncState,
  // Bridge handles rows as records; ephemeral Node[] is record-shaped at runtime (#233)
  rows: computed(() => props.rows as Record<string, unknown>[] | undefined),
  labelField: props.labelField,
  parentField: props.parentField,
  positionField: props.positionField,
  savedPositions: computed(() => props.savedPositions),
  localGhostNode,
  stopGhostCleanup
})

// Position sync: filter other users for presence display
const positionSyncOtherUsers = computed(() => {
  if (!positionSync) return []
  const currentId = positionSync.user.value?.id
  return positionSync.users.value.filter(u => u.user?.id !== currentId)
})

// ============================================
// STANDALONE MODE: Props-based data
// ============================================
// useFlowData reads rows by field key; treat them as records (#233)
const rowsRef = computed(() => (props.rows || []) as Record<string, unknown>[])

const { nodes: dataNodes, edges: dataEdges, getItem } = useFlowData(
  rowsRef,
  {
    parentField: props.parentField,
    positionField: props.positionField,
    labelField: props.labelField
  }
)

// Layout utilities
const layoutOptions = computed(() => ({
  direction: props.flowConfig?.direction ?? 'TB',
  nodeSpacing: props.flowConfig?.nodeSpacing ?? 50,
  rankSpacing: props.flowConfig?.rankSpacing ?? 100,
  nodeWidth: props.flowConfig?.nodeWidth ?? 172,
  nodeHeight: props.flowConfig?.nodeHeight ?? 36,
}))

const { applyLayout, applyLayoutToNew, applySubtreeLayout, getSubtreeIds, needsLayout } = useFlowLayout(layoutOptions.value)

// Position persistence strategy:
// 1. sync + ephemeral → Yjs position-only sync (real-time multiplayer)
// 2. flowId without sync → save to flow_configs.nodePositions (REST)
// 3. collection mode without flowId → PATCH collection row's position field
// 4. ephemeral without flowId/sync → no persistence
const { debouncedUpdate } = positionSync
  ? positionSync
  : (props.flowId && !props.sync)
    ? useFlowPositionStore(props.flowId!)
    : (props.dataMode !== 'ephemeral')
      ? useDebouncedPositionUpdate(props.collection, props.positionField, 500)
      : { debouncedUpdate: () => {} }

// Apply saved positions from flow_configs (if provided)
const positionedNodes = computed(() => {
  if (!props.savedPositions) return dataNodes.value
  return dataNodes.value.map((node) => {
    const saved = props.savedPositions![node.id]
    if (saved) {
      return { ...node, position: saved, _needsLayout: undefined }
    }
    return node
  })
})

// Position cache: remembers node positions across data refreshes
// When rows update (CRUD), nodes get recreated at (0,0) because collection
// data has no position field. This cache preserves last known positions.
// Seed from savedPositions so they survive data refreshes and dagre never overrides them.
const positionCache = reactive(new Map<string, { x: number; y: number }>())

// Locked node IDs: nodes with saved positions that dagre must never override.
// Seeded from savedPositions; drag-stop also locks the node.
const lockedNodeIds = ref<Set<string>>(new Set())

if (props.savedPositions) {
  for (const [id, pos] of Object.entries(props.savedPositions)) {
    positionCache.set(id, { ...pos })
    lockedNodeIds.value.add(id)
  }
}

// Update position cache when savedPositions prop changes (e.g. assistant rearranged nodes)
watch(() => props.savedPositions, (newPositions) => {
  if (!newPositions) return
  for (const [id, pos] of Object.entries(newPositions)) {
    positionCache.set(id, { ...pos })
    lockedNodeIds.value.add(id)
  }
}, { deep: true })

const cachedNodes = computed(() => {
  return positionedNodes.value.map((node) => {
    // Position cache always wins — it holds the latest drag position
    // and is more current than savedPositions (loaded once at mount)
    const cached = positionCache.get(node.id)
    if (cached) {
      return { ...node, position: cached, _needsLayout: undefined }
    }
    // Fall back to savedPositions / data position if non-zero
    if (node.position && (node.position.x !== 0 || node.position.y !== 0)) {
      return node
    }
    return node
  })
})

// Apply layout to standalone nodes (once on initial load, or when new nodes appear at 0,0)
const initialLayoutApplied = ref(false)
const layoutedNodes = computed(() => {
  const nodes = cachedNodes.value
  const edges = dataEdges.value
  const locked = lockedNodeIds.value

  if (!initialLayoutApplied.value && needsLayout(nodes)) {
    const result = applyLayout(nodes, edges, locked)
    // Cache the layout positions
    for (const node of result) {
      if (node.position) positionCache.set(node.id, { ...node.position })
    }
    nextTick(() => { initialLayoutApplied.value = true })
    return result
  }

  // Check if any nodes are at (0,0) after initial layout — these are newly added nodes
  if (initialLayoutApplied.value && nodes.some(n => !n.position || (n.position.x === 0 && n.position.y === 0))) {
    const result = applyLayoutToNew(nodes, edges, locked)
    // Cache new positions
    for (const node of result) {
      if (node.position && !positionCache.has(node.id)) {
        positionCache.set(node.id, { ...node.position })
      }
    }
    return result
  }

  return nodes
})

// ============================================
// FINAL COMPUTED VALUES
// ============================================

const layoutAppliedToYjs = ref(false)
const ephemeralPositionsApplied = ref(false)

const finalNodes = computed(() => {
  let baseNodes: Node[]

  if (props.dataMode === 'ephemeral') {
    // Ephemeral mode: rows are pre-built Vue Flow nodes
    let ephemeralNodes = (props.rows || []) as unknown as Node[]

    if (positionSync) {
      // Yjs position sync: apply positions reactively from Y.Map
      const yjsPositions = positionSync.positions.value
      if (Object.keys(yjsPositions).length > 0) {
        ephemeralNodes = ephemeralNodes.map((node) => {
          const saved = yjsPositions[node.id]
          if (saved) {
            return { ...node, position: saved }
          }
          return node
        })
      }
    } else if (props.savedPositions && !ephemeralPositionsApplied.value) {
      // REST position store: apply saved positions once on initial load
      ephemeralNodes = ephemeralNodes.map((node) => {
        const saved = props.savedPositions![node.id]
        if (saved) {
          return { ...node, position: saved }
        }
        return node
      })
      if (ephemeralNodes.length > 0) {
        ephemeralPositionsApplied.value = true
      }
    }
    baseNodes = ephemeralNodes
  } else if (props.sync && syncState) {
    const nodes = syncNodes.value

    // Fallback: if sync hasn't loaded nodes yet, show rows-based layout
    // so the canvas isn't blank while waiting for Yjs to connect/sync
    if (nodes.length === 0 && !syncState.synced.value) {
      baseNodes = layoutedNodes.value
    } else {
      const edges = syncEdges.value
      const needsLayoutResult = needsLayout(nodes)

      if (needsLayoutResult && !layoutAppliedToYjs.value) {
        // Initial layout — all nodes need positioning (locked nodes keep theirs)
        const layoutedNodesResult = applyLayout(nodes, edges, lockedNodeIds.value)

        nextTick(() => {
          for (const node of layoutedNodesResult) {
            if (node.position && typeof node.position.x === 'number' && typeof node.position.y === 'number') {
              syncState.updatePosition(node.id, node.position)
            }
          }
          layoutAppliedToYjs.value = true
        })

        baseNodes = layoutedNodesResult
      } else {
        // Use dagre incremental layout for new nodes arriving at (0,0)
        const hasNewNodes = nodes.some(n => n.position.x === 0 && n.position.y === 0)
        if (hasNewNodes) {
          const result = applyLayoutToNew(nodes, edges, lockedNodeIds.value)
          // Persist new positions to Yjs
          nextTick(() => {
            for (const node of result) {
              const original = nodes.find(n => n.id === node.id)
              if (original && original.position.x === 0 && original.position.y === 0
                && node.position && (node.position.x !== 0 || node.position.y !== 0)) {
                syncState.updatePosition(node.id, node.position)
              }
            }
          })
          baseNodes = result
        } else {
          baseNodes = nodes
        }
      }
    }
  } else {
    baseNodes = layoutedNodes.value
  }

  // Include ghost nodes (local + remote)
  const ghosts: Node[] = [
    ...(localGhostNode.value ? [localGhostNode.value] : []),
    ...remoteGhostNodes.value
  ]

  return [...baseNodes, ...ghosts]
})

const edgeType = computed(() => props.flowConfig?.edgeType || 'default')
const defaultEdgeOptions = computed(() => ({ type: edgeType.value }))

// Edges ref — v-model:edges lets Vue Flow manage connect/delete directly
const finalEdges = ref<Array<{ id: string; source: string; target: string; type?: string }>>([])

// Sync data-derived edges into the ref when rows change
// Merges with current state: adds new data edges, removes stale data edges, keeps user edges
let lastDataEdgeIds = new Set<string>()

watch(
  [dataEdges, syncEdges, () => props.additionalEdges, () => props.dataMode],
  () => {
    if (props.dataMode === 'ephemeral') {
      finalEdges.value = []
      lastDataEdgeIds = new Set()
      return
    }
    const rawEdges = (props.sync && syncState) ? syncEdges.value : dataEdges.value
    const extra = props.additionalEdges || []
    const type = edgeType.value
    // Normalize every edge (incl. additionalEdges, which carry no `type`) to the
    // configured edge type.
    const dataEdgeList: Array<{ id: string; source: string; target: string; type?: string }> =
      [...rawEdges, ...extra].map(e => ({ ...e, type }))
    const newDataIds = new Set(dataEdgeList.map(e => e.id))

    // Edges that were removed from data since last sync
    const removedFromData = new Set([...lastDataEdgeIds].filter(id => !newDataIds.has(id)))
    // Edges that are new in data
    const addedInData = dataEdgeList.filter(e => !lastDataEdgeIds.has(e.id))

    // Current edges minus removed, plus newly added
    const currentIds = new Set(finalEdges.value.map(e => e.id))
    const kept = finalEdges.value.filter(e => !removedFromData.has(e.id))
    const toAdd = addedInData.filter(e => !currentIds.has(e.id))

    console.log('[CroutonFlow] edge sync:', { dataCount: dataEdgeList.length, removed: [...removedFromData], added: toAdd.map(e => e.id), kept: kept.length, finalCount: kept.length + toAdd.length })

    finalEdges.value = [...kept, ...toAdd]
    lastDataEdgeIds = newDataIds
  },
  { immediate: true, deep: true },
)

// ============================================
// EVENT HANDLERS
// ============================================

// Handle node drag - sync position in real-time (throttled to 50ms)
const syncDragPosition = useThrottleFn((event: NodeDragEvent) => {
  if (!props.draggable || !props.sync) return

  const { node } = event
  const position: FlowPosition = {
    x: Math.round(node.position.x),
    y: Math.round(node.position.y)
  }

  if (syncState) {
    syncState.updatePosition(node.id, position)
  } else if (positionSync) {
    positionSync.debouncedUpdate(node.id, position)
  }
}, 50)

// Live drag forwarding: sync to collaborators (when sync) AND emit nodeDrag for the
// host to draw a snap/alignment guide. nodeDrag is NOT gated on sync — a non-sync
// canvas (e.g. the builder spike) still wants the live position for snap previews.
onNodeDrag((event: NodeDragEvent) => {
  syncDragPosition(event)
  if (!props.draggable) return
  emit('nodeDrag', event.node.id, {
    x: Math.round(event.node.position.x),
    y: Math.round(event.node.position.y),
  })
})

// Handle node drag end - final position sync + container detection
// event.nodes contains ALL dragged nodes (multi-select), event.node is just the primary
onNodeDragStop((event: NodeDragEvent) => {
  if (!props.draggable) return

  const draggedNodes = event.nodes

  // Container detection (if enabled) — only for the primary node
  if (containerDetection) {
    const result = containerDetection.handleDragStop(finalNodes.value, event)
    if (result) {
      emit('nodeContainerChange', result.change)
    }
  }

  // Persist positions for ALL dragged nodes
  for (const n of draggedNodes) {
    const position: FlowPosition = {
      x: Math.round(n.position.x),
      y: Math.round(n.position.y)
    }

    positionCache.set(n.id, { ...position })
    lockedNodeIds.value.add(n.id)

    if (props.sync && syncState) {
      syncState.updatePosition(n.id, position)
    } else {
      debouncedUpdate(n.id, position)
    }

    emit('nodeMove', n.id, position)
  }

  // In ephemeral mode, emit updated rows so parent can track position changes
  if (props.dataMode === 'ephemeral' && props.rows) {
    const movedIds = new Set(draggedNodes.map(n => n.id))
    const updatedRows = rowsRef.value.map(r => {
      const id = (r as any).id
      if (movedIds.has(id)) {
        const n = draggedNodes.find(dn => dn.id === id)!
        return { ...r, position: { x: Math.round(n.position.x), y: Math.round(n.position.y) } }
      }
      return r
    })
    emit('update:rows', updatedRows)
  }
})

// Handle node click
onNodeClick(({ node, event }) => {
  if (props.dataMode === 'ephemeral') {
    emit('nodeClick', node.id, node.data as Record<string, unknown>, event)
  } else if (props.sync && syncState) {
    const syncNode = syncState.getNode(node.id)
    syncState.selectNode(node.id)
    const data = syncNode
      ? { ...syncNode.data, id: syncNode.id, title: syncNode.title }
      : node.data as Record<string, unknown>
    emit('nodeClick', node.id, data, event)
  } else {
    const item = getItem(node.id)
    emit('nodeClick', node.id, item ?? node.data as Record<string, unknown>, event)
  }
})

// Handle node double-click
onNodeDoubleClick(({ node }) => {
  if (props.sync && syncState) {
    const syncNode = syncState.getNode(node.id)
    const data = syncNode
      ? { ...syncNode.data, id: syncNode.id, title: syncNode.title }
      : node.data as Record<string, unknown>
    emit('nodeDblClick', node.id, data)
  } else {
    const item = getItem(node.id)
    emit('nodeDblClick', node.id, item ?? node.data as Record<string, unknown>)
  }
})

// Handle edge click
onEdgeClick(({ edge }) => {
  emit('edgeClick', edge.id)
})

// Handle edge double-click — delete the connection
onEdgeDoubleClick(({ edge }) => {
  deleteEdge(edge)
})

// Handle edge removal via keyboard (select + backspace/delete) or v-model
onEdgesChange((changes) => {
  const removedIds = changes
    .filter(c => c.type === 'remove')
    .map(c => c.id)
  if (removedIds.length === 0) return

  for (const edgeId of removedIds) {
    const edge = finalEdges.value.find(e => e.id === edgeId)
    if (edge) deleteEdge(edge)
  }
})

function deleteEdge(edge: { id: string; source: string; target: string }) {
  const targetRow = rowsRef.value.find(r => (r as any).id === edge.target)
  const isParentEdge = targetRow?.[props.parentField] === edge.source

  if (isParentEdge) {
    patchNode(edge.target, { [props.parentField]: null })
  } else {
    const contextIds = Array.isArray((targetRow as any)?.contextNodeIds) ? [...(targetRow as any).contextNodeIds] : []
    const currentParent = targetRow?.[props.parentField] as string | null
    const updated = contextIds.filter((id: string) => id !== edge.source && id !== currentParent)
    patchNode(edge.target, {
      contextNodeIds: updated.length > 0 ? updated : [],
      ...(updated.length === 0 && { contextScope: 'branch' }),
    })
  }
}

// ============================================
// CUSTOM NODE RESOLUTION
// ============================================

// Try to resolve custom node component for this collection.
// resolveComponent returns a string (the component name) when not found in dev,
// or throws in production. We check the return type to detect presence.
const customNodeComponent = computed(() => {
  const pascalName = props.collection
    .split(/[-_]/)
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join('')

  const componentName = `${pascalName}Node`

  const resolved = resolveComponent(componentName)
  if (typeof resolved !== 'string') return resolved

  const lazyResolved = resolveComponent(`Lazy${componentName}`)
  if (typeof lazyResolved !== 'string') return lazyResolved

  return null
})

// ============================================
// LOCK / UNLOCK
// ============================================

/**
 * Unlock a node: removes its saved position so dagre can re-layout it.
 * Also removes the position from the position store (flow_configs).
 */
function unlockNode(nodeId: string) {
  lockedNodeIds.value.delete(nodeId)
  positionCache.delete(nodeId)
  // Reset the node's position to (0,0) so the next layout pass picks it up
  const node = findNode(nodeId)
  if (node) {
    node.position = { x: 0, y: 0 }
  }
  // Force a re-layout for the unlocked node
  initialLayoutApplied.value = false
  emit('nodeUnlock', nodeId)
}

// Provide lock state and unlock handler to child node components
provide('croutonFlowLockedIds', lockedNodeIds)
provide('croutonFlowUnlockNode', unlockNode)

// ============================================
// PUBLIC LAYOUT METHODS
// ============================================

/**
 * Re-layout all nodes using dagre, clearing all locked positions.
 */
function relayoutAll() {
  lockedNodeIds.value.clear()
  positionCache.clear()
  initialLayoutApplied.value = false

  const nodes = finalNodes.value.filter(n => n.type !== 'ghost')
  const edges = finalEdges.value
  const result = applyLayout(nodes, edges)

  for (const node of result) {
    if (node.position) {
      positionCache.set(node.id, { ...node.position })
      lockedNodeIds.value.add(node.id)
      if (syncState) {
        syncState.updatePosition(node.id, node.position)
      } else {
        debouncedUpdate(node.id, node.position)
      }
    }
  }
  initialLayoutApplied.value = true
}

/**
 * Layout only the subtree rooted at rootId using dagre.
 * Root keeps its current position; children are re-arranged below.
 */
function layoutSubtree(rootId: string) {
  const nodes = finalNodes.value.filter(n => n.type !== 'ghost')
  const edges = finalEdges.value
  const result = applySubtreeLayout(rootId, nodes, edges)

  // Persist new positions for subtree nodes
  const subtreeIds = getSubtreeIds(rootId, edges)
  for (const node of result) {
    if (subtreeIds.has(node.id) && node.position) {
      positionCache.set(node.id, { ...node.position })
      lockedNodeIds.value.add(node.id)
      if (syncState) {
        syncState.updatePosition(node.id, node.position)
      } else {
        debouncedUpdate(node.id, node.position)
      }
    }
  }
}

/**
 * Select a node and all its descendants.
 * Returns the set of selected IDs.
 */
function selectSubtree(rootId: string): string[] {
  const edges = finalEdges.value
  const ids = getSubtreeIds(rootId, edges)
  const nodeObjs = [...ids]
    .map(id => findNode(id))
    .filter(Boolean) as GraphNode[]
  addSelectedNodes(nodeObjs)
  const selectedIds = [...ids]
  emit('update:selected', selectedIds)
  return selectedIds
}

// Expose sync state and container detection for external access
defineExpose({
  syncState,
  containerDetection,
  lockedNodeIds,
  unlockNode,
  relayoutAll,
  layoutSubtree,
  selectSubtree,
  fitView,
  fitBounds,
  setCenter,
})
</script>

<template>
  <ClientOnly>
  <div ref="containerRef" class="crouton-flow-container"
    :class="{ 'crouton-flow-drop-target': isDragOver, 'crouton-flow-dark': isDark }"
    @dragover="handleDragOver"
    @dragleave="handleDragLeave"
    @drop="handleDrop"
  >
    <!-- Sync mode overlays (uses crouton-collab components) -->
    <template v-if="sync && syncState">
      <!-- Connection status indicator (bottom-left) -->
      <div class="crouton-flow-status">
        <CollabStatus
          :connected="syncState.connected.value"
          :synced="syncState.synced.value"
          :error="syncState.error.value"
          :show-label="false"
        />
      </div>

      <!-- Presence avatars (top-right) -->
      <div class="crouton-flow-presence">
        <CollabPresence
          :users="otherUsersInRoom"
          :max-visible="5"
          size="sm"
        />
      </div>

      <!-- Remote cursors overlay -->
      <CollabCursors
        :users="otherUsersInRoom"
        :show-labels="true"
      />
    </template>

    <!-- Position sync mode overlays (ephemeral + sync) -->
    <template v-if="positionSync">
      <div class="crouton-flow-status">
        <CollabStatus
          :connected="positionSync.connected.value"
          :synced="positionSync.synced.value"
          :error="positionSync.error.value"
          :show-label="false"
        />
      </div>

      <div class="crouton-flow-presence">
        <CollabPresence
          :users="positionSyncOtherUsers"
          :max-visible="5"
          size="sm"
        />
      </div>
    </template>

    <VueFlow
      :nodes="finalNodes"
      v-model:edges="finalEdges"
      :node-types="nodeTypes"
      :default-edge-options="defaultEdgeOptions"
      :min-zoom="0.1"
      :max-zoom="4"
      :fit-view-on-init="fitViewOnMount"
      :connection-mode="ConnectionMode.Loose"
      :connect-on-click="false"
      class="crouton-vue-flow"
      @connect="onNewConnection"
    >
      <!-- Custom or default node template -->
      <template #node-default="nodeProps">
        <!-- Ghost node (drag preview) -->
        <CroutonFlowGhostNode
          v-if="nodeProps.data?.isGhost"
          :data="nodeProps.data"
        />
        <!-- Injected node component (e.g. CroutonFlowSiteFlow's page card) -->
        <component
          :is="defaultNodeComponent"
          v-else-if="defaultNodeComponent"
          :data="nodeProps.data"
          :selected="nodeProps.selected"
          :dragging="nodeProps.dragging"
          :label="typeof nodeProps.label === 'string' ? nodeProps.label : undefined"
          :collection="collection"
        />
        <!-- Custom node component -->
        <component
          :is="customNodeComponent"
          v-else-if="customNodeComponent"
          :data="nodeProps.data"
          :selected="nodeProps.selected"
          :dragging="nodeProps.dragging"
          :label="typeof nodeProps.label === 'string' ? nodeProps.label : undefined"
          :collection="collection"
        />
        <!-- Default node -->
        <CroutonFlowNode
          v-else
          :data="nodeProps.data"
          :selected="nodeProps.selected"
          :dragging="nodeProps.dragging"
          :label="typeof nodeProps.label === 'string' ? nodeProps.label : undefined"
          :collection="collection"
        />
      </template>

      <!-- Background -->
      <Background
        v-if="background"
        :pattern-color="backgroundPatternColor || '#aaa'"
        :gap="16"
        :variant="backgroundPattern"
      />

      <!-- Controls -->
      <Controls
        v-if="controls"
        position="bottom-left"
      />

      <!-- Minimap -->
      <MiniMap
        v-if="minimap"
        position="bottom-right"
        :pannable="true"
        :zoomable="true"
      />

      <!-- Slot for additional content -->
      <slot />
    </VueFlow>
  </div>
  </ClientOnly>
</template>

<style scoped>
.crouton-flow-container {
  width: 100%;
  height: 100%;
  min-height: 400px;
  background-color: #fafafa;
  border-radius: 0.5rem;
  overflow: hidden;
  position: relative;
}

.crouton-flow-container.crouton-flow-dark {
  background-color: #0a0a0a;
}

.crouton-vue-flow {
  width: 100%;
  height: 100%;
}

.crouton-flow-loading {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  background-color: #fafafa;
}

.crouton-flow-dark .crouton-flow-loading {
  background-color: #0a0a0a;
}

.crouton-flow-spinner {
  width: 2rem;
  height: 2rem;
  border: 2px solid #d4d4d4;
  border-top-color: #3b82f6;
  border-radius: 9999px;
  animation: spin 1s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

/* Vue Flow overrides */
:deep(.vue-flow__node-default) {
  background: transparent;
  border: none;
  border-radius: 0;
  padding: 0;
  box-shadow: none;
}

:deep(.vue-flow__background) {
  background-color: #fafafa;
}

.crouton-flow-dark :deep(.vue-flow__background) {
  background-color: #0a0a0a;
}

:deep(.vue-flow__edge-path) {
  stroke: #a3a3a3;
}

.crouton-flow-dark :deep(.vue-flow__edge-path) {
  stroke: #525252;
}

:deep(.vue-flow__edge.selected .vue-flow__edge-path) {
  stroke: var(--color-primary-500, #3b82f6);
}

/* Controls overrides moved to unscoped block below */

:deep(.vue-flow__minimap) {
  background: white;
  border: 1px solid #e5e5e5;
  border-radius: 0.5rem;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.05);
}

.crouton-flow-dark :deep(.vue-flow__minimap) {
  background: #262626;
  border-color: #404040;
}

/* Drop zone styles - subtle border when dragging over */
.crouton-flow-drop-target {
  outline: 2px dashed var(--color-primary-500, #3b82f6);
  outline-offset: -2px;
}

/* Collab overlay positioning */
.crouton-flow-status {
  position: absolute;
  bottom: 12px;
  left: 12px;
  z-index: 100;
}

.crouton-flow-presence {
  position: absolute;
  top: 12px;
  right: 12px;
  z-index: 100;
}
</style>

<style>
/* Unscoped — needs to beat @vue-flow/controls/dist/style.css */
.crouton-flow-container .vue-flow__controls {
  background: white;
  border: 1px solid #e5e5e5;
  border-radius: 0.5rem;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
}

.crouton-flow-dark .vue-flow__controls {
  background: #1a1a1a;
  border-color: #333;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.3);
}

.crouton-flow-container .vue-flow__controls-button {
  background: transparent;
  color: #525252;
  border-bottom: 1px solid #e5e5e5;
}

.crouton-flow-container .vue-flow__controls-button:last-child {
  border-bottom: none;
}

.crouton-flow-dark .vue-flow__controls-button {
  color: #e5e5e5;
  border-bottom-color: #333;
}

.crouton-flow-container .vue-flow__controls-button:hover {
  background: #f5f5f5;
}

.crouton-flow-dark .vue-flow__controls-button:hover {
  background: #333;
}

.crouton-flow-container .vue-flow__controls-button svg {
  fill: currentColor;
}

.crouton-flow-dark .vue-flow__controls-button svg {
  fill: #e5e5e5;
}
</style>
