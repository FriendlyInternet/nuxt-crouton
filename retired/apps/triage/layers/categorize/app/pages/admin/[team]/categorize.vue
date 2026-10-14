<script setup lang="ts">
import { ref, shallowRef, computed, watch, markRaw, provide } from 'vue'
import type { Node } from '@vue-flow/core'
import { LAYOUT_ACTION_KEY } from '../../../utils/layoutAction'
import NotionCardNode from '../../../components/NotionCardNode.vue'
import ResizableGroupNode from '../../../components/ResizableGroupNode.vue'

interface ContainerChangeEvent {
  nodeId: string
  fromContainerId: string | null
  toContainerId: string | null
  position: { x: number, y: number }
}

definePageMeta({ layout: 'admin' })

const { teamId } = useTeamContext()

// Workspace layout ref
const layoutRef = ref<{ select: (item: any) => void; create: () => void; focusSearch: () => void } | null>(null)
const selectedLayoutId = ref<string | null>(null)
const toast = useToast()

// ─── Connected accounts ───
const { accounts, createManualAccount, fetchAccounts } = useTriageConnectedAccounts(
  computed(() => teamId.value ?? ''),
)

const notionAccounts = computed(() => accounts.value.filter(a => a.provider === 'notion'))
const accountItems = computed(() =>
  notionAccounts.value.map(a => ({ label: `${a.label} (${a.accessTokenHint || '***'})`, value: a.id })),
)

// ─── Connect modal state ───
const showConnectModal = ref(false)
const connectLabel = ref('')
const connectToken = ref('')
const connecting = ref(false)

async function connectNotionAccount() {
  if (!connectLabel.value.trim() || !connectToken.value.trim()) return
  connecting.value = true
  try {
    const result = await createManualAccount({
      provider: 'notion',
      label: connectLabel.value.trim(),
      token: connectToken.value.trim(),
    })
    if (result?.account) {
      selectedAccountId.value = result.account.id
    }
    showConnectModal.value = false
    connectLabel.value = ''
    connectToken.value = ''
    toast.add({ title: 'Notion account connected', color: 'success' })
  }
  catch (error: any) {
    toast.add({
      title: 'Failed to connect',
      description: error.data?.statusText || error.message,
      color: 'error',
    })
  }
  finally {
    connecting.value = false
  }
}

// ─── Setup state ───
const selectedAccountId = ref<string | null>(null)
const databaseId = ref('')
const databases = ref<{ id: string; title: string; icon?: string; url: string }[]>([])
const loadingDatabases = ref(false)
const categoryProperty = ref('')
const schema = ref<Record<string, { type: string; options?: { name: string }[] }>>({})

// ─── View mode (driven by workspace layout) ───
// 'view' = nothing selected, 'create' = setup form, 'edit' = canvas loaded
// We track canvas-loaded state separately since workspace 'edit' means a layout is selected
const canvasLoaded = ref(false)

// ─── Saved layouts (via collection query) ───
const { items: savedLayouts, pending: loadingLayouts, refresh: refreshLayouts } = await useCollectionQuery('categorizeCategorizeLayouts')


async function loadFromSavedLayout(layout: any) {
  selectedAccountId.value = layout.accountId
  databaseId.value = layout.databaseId
  categoryProperty.value = layout.categoryProperty || ''
  existingLayoutId.value = layout.id

  loading.value = true
  try {
    // Ensure flow config for position persistence
    await ensureFlowConfig(`categorize:${layout.databaseId}`)

    const [schemaRes, pagesRes] = await Promise.all([
      $fetch<any>(`/api/crouton-triage/teams/${teamId.value}/notion/schema/${layout.databaseId}`, {
        query: { accountId: layout.accountId },
      }),
      $fetch<any>(`/api/teams/${teamId.value}/notion/database/${layout.databaseId}/pages`, {
        query: { accountId: layout.accountId },
      }),
    ])

    schema.value = schemaRes.properties || {}
    pages.value = pagesRes.pages || []

    if (layout.layout) {
      restoreFromLayout(layout.layout)
    }
    else {
      buildNodesWithAutoGroup()
    }

    canvasLoaded.value = true
    toast.add({ title: `Loaded ${pages.value.length} cards`, color: 'success' })
  }
  catch (error: any) {
    toast.add({
      title: 'Failed to load',
      description: error.data?.statusText || error.message,
      color: 'error',
    })
  }
  finally {
    loading.value = false
  }
}

async function deleteSavedLayout(layoutId: string) {
  try {
    await $fetch(`/api/teams/${teamId.value}/categorize-categorize-layouts/${layoutId}`, {
      method: 'DELETE',
    })
    await refreshLayouts()
    toast.add({ title: 'Layout deleted', color: 'success' })
  }
  catch (error: any) {
    toast.add({ title: 'Failed to delete', description: error.data?.statusText || error.message, color: 'error' })
  }
}

// ─── Workspace helpers ───
function handleSelectLayout(layout: any) {
  selectedLayoutId.value = layout.id
  layoutRef.value?.select(layout)
  loadFromSavedLayout(layout)
}

function handleCreateLayout() {
  canvasLoaded.value = false
  selectedAccountId.value = null
  databaseId.value = ''
  categoryProperty.value = ''
  existingLayoutId.value = null
  pages.value = []
  nodes.value = []
  layoutRef.value?.create()
}

// ─── Data state ───
const pages = ref<any[]>([])
const loading = ref(false)
const saving = ref(false)

// ─── Layout persistence ───
const existingLayoutId = ref<string | null>(null)

// ─── Flow position persistence ───
const canvasFlowId = ref<string | null>(null)
const canvasSavedPositions = ref<Record<string, { x: number; y: number }> | null>(null)

async function ensureFlowConfig(name: string) {
  const teamIdVal = teamId.value
  if (!teamIdVal) return

  // Try to find existing flow config for this categorize canvas
  try {
    const flows = await $fetch<any[]>(`/api/crouton-flow/teams/${teamIdVal}/flows`, {
      query: { collection: 'categorize', name },
    })
    const existing = flows?.find((f: any) => f.name === name && f.collection === 'categorize')
    if (existing) {
      canvasFlowId.value = existing.id
      canvasSavedPositions.value = existing.nodePositions || null
      return
    }
  }
  catch { /* no existing flow config */ }

  // Create one
  try {
    const created = await $fetch<any>(`/api/crouton-flow/teams/${teamIdVal}/flows`, {
      method: 'POST',
      body: { name, collection: 'categorize', labelField: 'title', parentField: 'parentId', positionField: 'position' },
    })
    if (created?.id) {
      canvasFlowId.value = created.id
    }
  }
  catch (e) {
    console.warn('[categorize] Failed to create flow config for position persistence:', e)
  }
}

// ─── Card detail slideover ───
const selectedCard = ref<any>(null)
const showCardDetail = ref(false)

// ─── View tab ───
const activeTab = ref<'canvas' | 'insights'>('canvas')

// ─── Filters ───
const showFilterPopover = ref(false)
const activeFilterProperty = ref<string | undefined>(undefined)
const hiddenValues = ref<Map<string, Set<string>>>(new Map())

// All filterable properties (select, status, multi_select, checkbox)
const filterableProperties = computed(() => {
  return Object.entries(schema.value)
    .filter(([_, prop]) => ['select', 'status', 'multi_select', 'checkbox'].includes(prop.type))
    .map(([name, prop]) => ({ name, type: prop.type, options: prop.options || [] }))
})

// Distinct values for the active filter property (extracted from loaded pages)
const activeFilterValues = computed(() => {
  if (!activeFilterProperty.value) return []
  const propName = activeFilterProperty.value
  const valueSet = new Set<string>()
  for (const page of pages.value) {
    const val = page.properties[propName]
    if (val == null || val === '') continue
    if (Array.isArray(val)) {
      val.forEach((v: string) => valueSet.add(String(v)))
    }
    else {
      valueSet.add(String(val))
    }
  }
  return Array.from(valueSet).sort()
})

function isValueHidden(property: string, value: string): boolean {
  return hiddenValues.value.get(property)?.has(value) ?? false
}

function toggleFilterValue(property: string, value: string) {
  const map = new Map(hiddenValues.value)
  if (!map.has(property)) map.set(property, new Set())
  const set = new Set(map.get(property)!)
  if (set.has(value)) {
    set.delete(value)
  }
  else {
    set.add(value)
  }
  if (set.size === 0) {
    map.delete(property)
  }
  else {
    map.set(property, set)
  }
  hiddenValues.value = map
}

function clearAllFilters() {
  hiddenValues.value = new Map()
}

const activeFilterCount = computed(() => {
  let count = 0
  for (const set of hiddenValues.value.values()) {
    count += set.size
  }
  return count
})

// Flat list for template display
const hiddenValuesList = computed(() => {
  const list: { property: string; value: string }[] = []
  for (const [prop, vals] of hiddenValues.value) {
    for (const val of vals) {
      list.push({ property: prop, value: val })
    }
  }
  return list
})

// Filtered pages based on hidden values
const filteredPages = computed(() => {
  if (hiddenValues.value.size === 0) return pages.value
  return pages.value.filter((page) => {
    for (const [propName, hiddenSet] of hiddenValues.value) {
      const val = page.properties[propName]
      if (val == null || val === '') continue
      if (Array.isArray(val)) {
        if (val.some((v: string) => hiddenSet.has(String(v)))) return false
      }
      else {
        if (hiddenSet.has(String(val))) return false
      }
    }
    return true
  })
})

// ─── Card detail computeds ───
const CARD_SKIP_KEYS = ['Status', 'status', 'Type', 'type', 'Category', 'category', 'Reach', 'reach', 'Impact', 'impact', 'Confidence', 'confidence', 'Effort', 'effort']

const cardFilteredProperties = computed(() => {
  if (!selectedCard.value) return {}
  const result: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(selectedCard.value.properties)) {
    if (CARD_SKIP_KEYS.includes(key)) continue
    if (value == null || value === '' || (Array.isArray(value) && value.length === 0)) continue
    result[key] = value
  }
  return result
})

const cardRice = computed(() => {
  if (!selectedCard.value) return null
  const p = selectedCard.value.properties
  const r = getRiceField(p, 'Reach')
  const i = getRiceField(p, 'Impact')
  const c = getRiceField(p, 'Confidence')
  const e = getRiceField(p, 'Effort')
  const score = computeRice(p)
  if (score == null) return null
  return {
    score: Math.round(score),
    components: [
      { label: 'Reach', value: r, max: 10, color: 'bg-blue-500' },
      { label: 'Impact', value: i, max: 5, color: 'bg-emerald-500' },
      { label: 'Confidence', value: c, max: 5, color: 'bg-amber-500' },
      { label: 'Effort', value: e, max: 10, color: 'bg-red-500' },
    ],
    chartData: [
      { name: 'Reach', Value: r ?? 0 },
      { name: 'Impact', Value: i ?? 0 },
      { name: 'Confidence', Value: c ?? 0 },
      { name: 'Effort', Value: e ?? 0 },
    ],
  }
})

// ─── Group manager ───
const groupManager = useFlowGroupManager({
  groupNodeType: 'resizableGroup',
})
const groups = groupManager.groups
const showGroupModal = ref(false)
const newGroupName = ref('')

// ─── Node type components for CroutonFlow ───
const nodeTypeComponents = {
  notionCard: { component: markRaw(NotionCardNode) },
  resizableGroup: { component: markRaw(ResizableGroupNode), isContainer: true },
}

// ─── Canvas nodes ───
// shallowRef (not ref) is deliberate: nodes is always reassigned as a whole
// array, so shallow reactivity is sufficient — and it keeps .value as plain
// Node[] instead of UnwrapRef<Node[]>, which Vue 3.5.3x makes deep enough to
// trip TS2589 ("excessively deep") on every .value access (#242).
const nodes = shallowRef<Node[]>([])

// ─── Auth params helper ───
const authParams = computed(() => {
  if (selectedAccountId.value) {
    return { accountId: selectedAccountId.value }
  }
  return null
})

// ─── All database properties ───
const allProperties = computed(() => {
  return Object.entries(schema.value).map(([name, prop]) => ({
    label: `${name} (${prop.type})`,
    value: name,
    disabled: !['select', 'status', 'multi_select'].includes(prop.type),
  }))
})

const writableProperties = computed(() => {
  return allProperties.value.filter(p => !p.disabled)
})

// ─── Create property ───
const newPropertyName = ref('')
const showCreateProperty = ref(false)
const creatingProperty = ref(false)

async function createNotionProperty() {
  if (!newPropertyName.value.trim() || !authParams.value) return
  creatingProperty.value = true

  try {
    await $fetch(`/api/teams/${teamId.value}/notion/database/${databaseId.value}/property`, {
      method: 'POST',
      body: {
        ...authParams.value,
        propertyName: newPropertyName.value.trim(),
      },
    })

    schema.value[newPropertyName.value.trim()] = { type: 'select', options: [] }
    categoryProperty.value = newPropertyName.value.trim()
    showCreateProperty.value = false
    newPropertyName.value = ''
    toast.add({ title: `Created "${categoryProperty.value}" column in Notion`, color: 'success' })
  }
  catch (error: any) {
    toast.add({
      title: 'Failed to create property',
      description: error.data?.message || error.message,
      color: 'error',
    })
  }
  finally {
    creatingProperty.value = false
  }
}

// ─── Fetch databases when account selected ───
watch(selectedAccountId, async (accountId) => {
  if (!accountId) {
    databases.value = []
    return
  }

  loadingDatabases.value = true
  try {
    const res = await $fetch<any>(`/api/teams/${teamId.value}/notion/databases`, {
      query: { accountId },
    })
    databases.value = res.databases || []
  }
  catch (error: any) {
    toast.add({
      title: 'Failed to load databases',
      description: error.data?.statusText || error.message,
      color: 'error',
    })
    databases.value = []
  }
  finally {
    loadingDatabases.value = false
  }
})

// Database select items
const databaseItems = computed(() =>
  databases.value.map(db => ({
    label: `${db.icon || ''} ${db.title}`.trim(),
    value: db.id,
  })),
)

// ─── Load pages from Notion ───
async function loadPages() {
  if (!databaseId.value || !authParams.value) {
    toast.add({ title: 'Select an account and database first', color: 'warning' })
    return
  }

  loading.value = true

  try {
    const [schemaRes, pagesRes] = await Promise.all([
      $fetch<any>(`/api/crouton-triage/teams/${teamId.value}/notion/schema/${databaseId.value}`, {
        query: authParams.value,
      }),
      $fetch<any>(`/api/teams/${teamId.value}/notion/database/${databaseId.value}/pages`, {
        query: authParams.value,
      }),
    ])

    schema.value = schemaRes.properties || {}
    pages.value = pagesRes.pages || []

    // Auto-select first writable property if available
    if (!categoryProperty.value && writableProperties.value.length > 0) {
      categoryProperty.value = writableProperties.value[0]!.value
    }

    // Ensure flow config exists for position persistence
    await ensureFlowConfig(`categorize:${databaseId.value}`)

    // Check for a saved layout
    try {
      const savedLayout = await $fetch<any>(`/api/teams/${teamId.value}/categorize-categorize-layouts`, {
        query: { databaseId: databaseId.value, accountId: selectedAccountId.value },
      })
      if (savedLayout?.id) {
        existingLayoutId.value = savedLayout.id
        if (savedLayout.categoryProperty) {
          categoryProperty.value = savedLayout.categoryProperty
        }
        restoreFromLayout(savedLayout.layout)
        canvasLoaded.value = true
        toast.add({ title: `Loaded ${pages.value.length} cards (layout restored)`, color: 'success' })
        return
      }
    }
    catch {
      // No saved layout found, continue with auto-group
    }

    // Build nodes — auto-group by existing values
    buildNodesWithAutoGroup()
    canvasLoaded.value = true

    toast.add({ title: `Loaded ${pages.value.length} cards`, color: 'success' })
  }
  catch (error: any) {
    toast.add({
      title: 'Failed to load',
      description: error.data?.statusText || error.message,
      color: 'error',
    })
  }
  finally {
    loading.value = false
  }
}

// ─── Build nodes with auto-grouping by existing property values ───
function buildCardNode(page: any): Omit<Node, 'position'> {
  return {
    id: page.id,
    type: 'notionCard',
    data: {
      title: page.title,
      properties: page.properties,
      url: page.url,
      grouped: false,
      createdTime: page.createdTime,
      lastEditedTime: page.lastEditedTime,
      createdBy: page.createdBy,
      lastEditedBy: page.lastEditedBy,
    },
  }
}

function buildNodesWithAutoGroup() {
  const visiblePages = filteredPages.value

  if (categoryProperty.value) {
    nodes.value = groupManager.autoGroupByProperty(
      visiblePages,
      categoryProperty.value,
      (page) => {
        const val = page.properties[categoryProperty.value]
        if (!val) return null
        if (typeof val === 'string') return val
        if (Array.isArray(val) && val.length > 0) return String(val[0])
        return null
      },
      buildCardNode,
    )
  }
  else {
    // No category property — place all cards in a grid
    const GAP = 30
    const CARD_W = 220
    const CARD_H = 120
    const cols = Math.max(1, Math.ceil(Math.sqrt(visiblePages.length)))

    nodes.value = visiblePages.map((page, i) => ({
      ...buildCardNode(page),
      position: {
        x: (i % cols) * (CARD_W + GAP) + 50,
        y: Math.floor(i / cols) * (CARD_H + GAP) + 50,
      },
    } as Node))
  }
}

// ─── Build a snapshot of current canvas layout for persistence ───
function buildLayoutSnapshot() {
  const groupSnapshots = groups.value.map((g) => {
    const groupNode = nodes.value.find(n => n.id === g.id)
    const styleObj = groupNode?.style as Record<string, string> | undefined
    return {
      id: g.id,
      name: g.name,
      color: g.color,
      position: groupNode?.position || { x: 0, y: 0 },
      width: parseInt(styleObj?.width || '500'),
      height: parseInt(styleObj?.height || '400'),
    }
  })

  const cardSnapshots = nodes.value
    .filter(n => n.type === 'notionCard')
    .map((n, index) => ({
      pageId: n.id,
      groupId: n.parentNode || null,
      position: n.position,
      sortOrder: index,
    }))

  return { groups: groupSnapshots, cards: cardSnapshots }
}

// ─── Restore canvas from a saved layout ───
function restoreFromLayout(layout: { groups: any[]; cards: any[] }) {
  const CARD_W = 220
  const CARD_H = 120
  const GAP = 30

  // Restore groups via group manager
  groupManager.restoreGroups(layout.groups)

  const allNodes: Node[] = []
  const restoredPageIds = new Set<string>()
  const visiblePages = filteredPages.value
  const visiblePageIds = new Set(visiblePages.map(p => p.id))

  // Restore group nodes
  for (const g of layout.groups) {
    allNodes.push({
      id: g.id,
      type: 'resizableGroup',
      position: g.position,
      data: { label: g.name },
      style: {
        width: `${g.width}px`,
        height: `${g.height}px`,
        backgroundColor: g.color,
        borderRadius: '12px',
        border: '2px dashed #9ca3af',
        opacity: '0.6',
      },
    })
  }

  // Restore cards — only for pages that still exist
  const sortedCards = [...layout.cards].sort((a, b) => a.sortOrder - b.sortOrder)
  for (const card of sortedCards) {
    if (!visiblePageIds.has(card.pageId)) continue
    const page = visiblePages.find(p => p.id === card.pageId)
    if (!page) continue

    restoredPageIds.add(card.pageId)

    const nodeData: Node = {
      ...buildCardNode(page),
      position: card.position,
      data: { ...buildCardNode(page).data, grouped: !!card.groupId },
    }
    if (card.groupId) {
      nodeData.parentNode = card.groupId
    }
    allNodes.push(nodeData)
  }

  // Place new pages (not in saved layout) in an ungrouped grid below
  const newPages = visiblePages.filter(p => !restoredPageIds.has(p.id))
  if (newPages.length > 0) {
    let maxY = 0
    for (const n of allNodes) {
      const styleObj = n.style as Record<string, string> | undefined
      const h = parseInt(styleObj?.height || '120')
      maxY = Math.max(maxY, n.position.y + h)
    }

    const ungroupedY = maxY + 80
    const ungroupedCols = Math.max(1, Math.ceil(Math.sqrt(newPages.length)))

    for (let i = 0; i < newPages.length; i++) {
      const page = newPages[i]!
      allNodes.push({
        ...buildCardNode(page),
        position: {
          x: (i % ungroupedCols) * (CARD_W + GAP) + 50,
          y: Math.floor(i / ungroupedCols) * (CARD_H + GAP) + ungroupedY,
        },
      } as Node)
    }
  }

  nodes.value = allNodes
}

// ─── Per-column layout cache ───
// Stores layout snapshots keyed by column name so switching columns preserves arrangements
const columnLayoutCache = ref<Map<string, { groups: any[]; cards: any[] }>>(new Map())

// ─── Re-group when category property or filters change ───
watch(categoryProperty, (newCol, oldCol) => {
  if (!canvasLoaded.value || pages.value.length === 0) return

  // Save current layout for the old column
  if (oldCol && nodes.value.length > 0) {
    columnLayoutCache.value.set(oldCol, buildLayoutSnapshot())
  }

  // Restore cached layout for the new column, or auto-group from scratch
  const cached = newCol ? columnLayoutCache.value.get(newCol) : undefined
  if (cached) {
    restoreFromLayout(cached)
  }
  else {
    buildNodesWithAutoGroup()
  }
})

watch(hiddenValues, () => {
  if (canvasLoaded.value && pages.value.length > 0) {
    buildNodesWithAutoGroup()
  }
}, { deep: true })

// ─── Create a group ───
function createGroup() {
  if (!newGroupName.value.trim()) return

  const groupNode = groupManager.createGroup(newGroupName.value.trim())
  // Reassign (not push): shallowRef only reacts to .value replacement.
  nodes.value = [...nodes.value, groupNode]

  newGroupName.value = ''
  showGroupModal.value = false
}

// ─── Remove a group ───
function removeGroup(groupId: string) {
  nodes.value = groupManager.removeGroup(nodes.value, groupId)
}

// ─── Rename a group ───
const editingGroupId = ref<string | null>(null)
const editingGroupName = ref('')

function startRenameGroup(groupId: string) {
  const group = groups.value.find(g => g.id === groupId)
  if (!group) return
  editingGroupId.value = groupId
  editingGroupName.value = group.name
}

function commitRenameGroup() {
  if (!editingGroupId.value || !editingGroupName.value.trim()) {
    editingGroupId.value = null
    return
  }
  nodes.value = groupManager.renameGroup(nodes.value, editingGroupId.value, editingGroupName.value.trim())
  editingGroupId.value = null
}

// ─── Handle node click — show card detail ───
function handleNodeClick(nodeId: string, data: Record<string, unknown>) {
  // Only show detail for card nodes, not group nodes
  if (groups.value.some(g => g.id === nodeId)) return
  selectedCard.value = data
  showCardDetail.value = true
}

// ─── Handle container change (card dragged into/out of group) ───
function handleContainerChange(event: ContainerChangeEvent) {
  nodes.value = nodes.value.map((n) => {
    if (n.id !== event.nodeId) return n

    if (event.toContainerId) {
      return {
        ...n,
        parentNode: event.toContainerId,
        position: event.position,
        data: { ...n.data, grouped: true },
      }
    }
    else {
      return {
        ...n,
        parentNode: undefined,
        extent: undefined,
        position: event.position,
        data: { ...n.data, grouped: false },
      }
    }
  })
}

// ─── Get category assignments ───
const assignments = computed(() => {
  return nodes.value
    .filter(n => n.type === 'notionCard' && n.parentNode)
    .map((n) => {
      const group = groups.value.find(g => g.id === n.parentNode)
      return {
        pageId: n.id,
        title: n.data.title,
        category: group?.name || '',
      }
    })
    .filter(a => a.category)
})

const uncategorizedCount = computed(() => {
  return nodes.value.filter(n => n.type === 'notionCard' && !n.parentNode).length
})

// ─── RICE score helpers ───
function getRiceField(props: Record<string, unknown>, field: string): number | null {
  const val = props[field] ?? props[field.toLowerCase()] ?? props[field.charAt(0).toUpperCase() + field.slice(1)]
  return typeof val === 'number' ? val : null
}

function computeRice(props: Record<string, unknown>): number | null {
  const r = getRiceField(props, 'Reach')
  const i = getRiceField(props, 'Impact')
  const c = getRiceField(props, 'Confidence')
  const e = getRiceField(props, 'Effort')
  if (r == null || i == null || c == null || e == null || e === 0) return null
  return (r * i * c) / e
}

const hasRiceScores = computed(() => {
  return pages.value.some(p => computeRice(p.properties) != null)
})

// Sorted pages by RICE score (descending)
const pagesByRice = computed(() => {
  return pages.value
    .map(p => ({ ...p, rice: computeRice(p.properties) }))
    .filter(p => p.rice != null)
    .sort((a, b) => (b.rice ?? 0) - (a.rice ?? 0))
})

// Chart data: RICE scores by card (bar chart)
const riceBarData = computed(() => {
  return pagesByRice.value.slice(0, 30).map(p => ({
    name: p.title.length > 25 ? `${p.title.slice(0, 25)}...` : p.title,
    RICE: Math.round(p.rice ?? 0),
  }))
})

const riceBarCategories = computed(() => ({
  RICE: { name: 'RICE', color: '#3b82f6' },
}))

// Chart data: RICE components breakdown (stacked bar)
const riceComponentsData = computed(() => {
  return pagesByRice.value.slice(0, 20).map(p => ({
    name: p.title.length > 20 ? `${p.title.slice(0, 20)}...` : p.title,
    Reach: getRiceField(p.properties, 'Reach') ?? 0,
    Impact: getRiceField(p.properties, 'Impact') ?? 0,
    Confidence: getRiceField(p.properties, 'Confidence') ?? 0,
    Effort: getRiceField(p.properties, 'Effort') ?? 0,
  }))
})

const riceComponentCategories = computed(() => ({
  Reach: { name: 'Reach', color: '#3b82f6' },
  Impact: { name: 'Impact', color: '#10b981' },
  Confidence: { name: 'Confidence', color: '#f59e0b' },
  Effort: { name: 'Effort', color: '#ef4444' },
}))

// Chart data: RICE by category (donut)
const riceByCategoryData = computed(() => {
  const categoryMap = new Map<string, number[]>()
  for (const node of nodes.value) {
    if (node.type !== 'notionCard') continue
    const group = node.parentNode ? groups.value.find(g => g.id === node.parentNode) : null
    const category = group?.name || 'Uncategorized'
    const page = pages.value.find(p => p.id === node.id)
    if (!page) continue
    const rice = computeRice(page.properties)
    if (rice == null) continue
    if (!categoryMap.has(category)) categoryMap.set(category, [])
    categoryMap.get(category)!.push(rice)
  }
  return Array.from(categoryMap.entries()).map(([name, scores]) => ({
    name,
    avgRice: Math.round(scores.reduce((a, b) => a + b, 0) / scores.length),
    totalRice: Math.round(scores.reduce((a, b) => a + b, 0)),
    count: scores.length,
  }))
})

// Summary stats
const riceStats = computed(() => {
  const scores = pagesByRice.value.map(p => p.rice ?? 0)
  if (scores.length === 0) return null
  return {
    total: scores.length,
    avg: Math.round(scores.reduce((a, b) => a + b, 0) / scores.length),
    max: Math.round(Math.max(...scores)),
    min: Math.round(Math.min(...scores)),
  }
})

// ─── Save to Notion ───
async function saveToNotion() {
  if (!categoryProperty.value) {
    toast.add({ title: 'Select a category property first', color: 'warning' })
    return
  }

  if (assignments.value.length === 0) {
    toast.add({ title: 'No cards assigned to groups yet', color: 'warning' })
    return
  }

  if (!authParams.value) return

  saving.value = true

  try {
    const result = await $fetch<any>(`/api/teams/${teamId.value}/notion/database/${databaseId.value}/categorize`, {
      method: 'POST',
      body: {
        ...authParams.value,
        propertyName: categoryProperty.value,
        propertyType: schema.value[categoryProperty.value]?.type || 'select',
        assignments: assignments.value.map(a => ({
          pageId: a.pageId,
          category: a.category,
        })),
      },
    })

    if (result.failed > 0) {
      const failedResults = result.results?.filter((r: any) => !r.success) || []
      const firstError = failedResults[0]?.error || 'Unknown error'
      console.warn('[categorize] Failed updates:', failedResults)
      toast.add({
        title: `Updated ${result.succeeded}/${result.total} cards (${result.failed} failed)`,
        description: firstError,
        color: 'warning',
      })
    }
    else {
      toast.add({
        title: `Updated ${result.succeeded} cards in Notion`,
        color: 'success',
      })
    }

    // Persist canvas layout
    try {
      const layoutData = {
        name: databaseId.value,
        databaseId: databaseId.value,
        accountId: selectedAccountId.value,
        categoryProperty: categoryProperty.value,
        layout: buildLayoutSnapshot(),
      }

      if (existingLayoutId.value) {
        await $fetch(`/api/teams/${teamId.value}/categorize-categorize-layouts/${existingLayoutId.value}`, {
          method: 'PATCH',
          body: layoutData,
        })
      }
      else {
        const created = await $fetch<any>(`/api/teams/${teamId.value}/categorize-categorize-layouts`, {
          method: 'POST',
          body: layoutData,
        })
        if (created?.id) {
          existingLayoutId.value = created.id
        }
      }
      toast.add({ title: 'Canvas layout saved', color: 'success' })
      refreshLayouts()
    }
    catch (layoutError: any) {
      console.warn('[categorize] Failed to save layout:', layoutError)
      toast.add({
        title: 'Layout save failed',
        description: layoutError.data?.statusText || layoutError.message,
        color: 'warning',
      })
    }
  }
  catch (error: any) {
    toast.add({
      title: 'Failed to save',
      description: error.data?.statusText || error.message,
      color: 'error',
    })
  }
  finally {
    saving.value = false
  }
}
</script>

<template>
  <CroutonWorkspaceLayout
    ref="layoutRef"
    v-model="selectedLayoutId"
    query-param="layout"
    title="Categorize"
    sidebar-id="categorize-sidebar"
    :create-shortcut="false"
  >
    <!-- Sidebar actions -->
    <template #sidebar-actions>
      <UButton
        color="primary"
        variant="ghost"
        icon="i-lucide-plus"
        size="sm"
        @click="handleCreateLayout"
      />
    </template>

    <!-- Sidebar: saved layouts list -->
    <template #sidebar="{ selectedId }">
      <div class="flex flex-col h-full">
        <!-- Loading -->
        <div v-if="loadingLayouts" class="p-3 space-y-2">
          <USkeleton class="h-16 w-full" />
          <USkeleton class="h-16 w-full" />
          <USkeleton class="h-16 w-full" />
        </div>

        <!-- Empty -->
        <div
          v-else-if="!savedLayouts.length"
          class="p-6 text-center text-muted flex-1"
        >
          <UIcon name="i-lucide-layout-grid" class="size-8 mb-2 opacity-50" />
          <p class="text-sm">No saved layouts yet</p>
          <UButton
            size="sm"
            color="primary"
            variant="soft"
            class="mt-3"
            @click="handleCreateLayout"
          >
            New Layout
          </UButton>
        </div>

        <!-- Layout list -->
        <div v-else class="flex-1 overflow-auto">
          <ul role="list" class="divide-y divide-default">
            <li
              v-for="layout in savedLayouts"
              :key="layout.id"
              class="group px-4 py-3 cursor-pointer transition-colors"
              :class="[
                selectedId === layout.id
                  ? 'bg-primary/10 border-l-2 border-primary'
                  : 'hover:bg-muted/50 border-l-2 border-transparent'
              ]"
              @click="handleSelectLayout(layout)"
            >
              <div class="flex items-center gap-2.5 min-w-0">
                <div class="flex-1 min-w-0">
                  <p class="text-sm font-medium text-default truncate">
                    {{ layout.name || 'Untitled Layout' }}
                  </p>
                  <div class="flex items-center gap-2 mt-0.5 text-xs text-muted">
                    <span>{{ layout.layout?.groups?.length || 0 }} groups</span>
                    <span>{{ layout.layout?.cards?.length || 0 }} cards</span>
                  </div>
                </div>
                <UButton
                  icon="i-lucide-trash-2"
                  size="xs"
                  variant="ghost"
                  color="error"
                  class="opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
                  @click.stop="deleteSavedLayout(layout.id)"
                />
              </div>
            </li>
          </ul>
        </div>

        <!-- Create button at bottom -->
        <div class="shrink-0 border-t border-default p-4">
          <UButton
            color="primary"
            variant="soft"
            size="sm"
            icon="i-lucide-plus"
            block
            @click="handleCreateLayout"
          >
            New Layout
          </UButton>
        </div>
      </div>
    </template>

    <!-- Content panel -->
    <template #content="{ mode }">
      <div class="flex flex-col h-full w-full overflow-hidden">
        <!-- Setup form (create mode — before canvas is loaded) -->
        <template v-if="mode === 'create' || (mode === 'edit' && !canvasLoaded && !loading)">
          <div class="flex-1 flex items-center justify-center">
            <div class="w-full max-w-lg space-y-4 px-6">
              <div class="mb-2">
                <span class="text-sm font-medium">New Layout</span>
                <p class="text-xs text-muted mt-0.5">Connect a Notion database and load cards</p>
              </div>

              <!-- Account picker -->
              <UFormField label="Notion Account">
                <div class="flex gap-2">
                  <USelect
                    v-model="selectedAccountId"
                    :items="accountItems"
                    placeholder="Select account..."
                    value-key="value"
                    class="flex-1"
                  />
                  <UButton
              icon="i-lucide-plus"
              variant="soft"
              @click="showConnectModal = true"
            />
          </div>
        </UFormField>

        <!-- Database picker -->
        <UFormField v-if="selectedAccountId" label="Database">
          <USelect
            v-model="databaseId"
            :items="databaseItems"
            placeholder="Select a database..."
            :loading="loadingDatabases"
            class="w-full"
            value-key="value"
          />
        </UFormField>

              <UButton
                block
                :loading="loading"
                :disabled="!databaseId || !authParams"
                @click="loadPages"
              >
                Load Cards
              </UButton>
            </div>
          </div>
        </template>

        <!-- Loading state -->
        <div v-else-if="loading" class="flex-1 flex items-center justify-center">
          <UIcon name="i-lucide-loader-2" class="size-6 text-muted animate-spin" />
        </div>

        <!-- Canvas content (loaded) -->
        <template v-else>
          <!-- Canvas header toolbar -->
          <div class="flex items-center justify-between px-4 py-2.5 border-b border-default bg-default shrink-0">
            <div class="flex items-center gap-3">
              <!-- View tabs -->
              <div class="flex items-center rounded-lg bg-gray-100 dark:bg-gray-800 p-0.5">
                <button
                  class="px-3 py-1 text-sm rounded-md transition-colors"
                  :class="activeTab === 'canvas' ? 'bg-white dark:bg-gray-700 shadow-sm font-medium' : 'text-gray-500 hover:text-gray-700'"
                  @click="activeTab = 'canvas'"
                >
                  Canvas
                </button>
                <button
                  class="px-3 py-1 text-sm rounded-md transition-colors"
                  :class="activeTab === 'insights' ? 'bg-white dark:bg-gray-700 shadow-sm font-medium' : 'text-gray-500 hover:text-gray-700'"
                  @click="activeTab = 'insights'"
                >
                  Insights
                </button>
              </div>

              <USeparator orientation="vertical" class="h-4" />

              <span class="text-sm text-muted">
                {{ assignments.length }} categorized / {{ uncategorizedCount }} remaining<template v-if="activeFilterCount > 0"> ({{ pages.length - filteredPages.length }} hidden)</template>
              </span>
            </div>

            <div class="flex items-center gap-2">
              <UButton
                icon="i-lucide-plus"
                size="sm"
                variant="soft"
                @click="showGroupModal = true"
              >
                Add Group
              </UButton>
              <UButton
                icon="i-lucide-cloud-upload"
                size="sm"
                :loading="saving"
                :disabled="assignments.length === 0 || !categoryProperty"
                @click="saveToNotion"
              >
                Save to Notion
              </UButton>
            </div>
          </div>

          <!-- Canvas tab -->
      <div v-show="activeTab === 'canvas'" class="flex flex-col flex-1 min-h-0">
      <!-- Property selector + group chips -->
      <div class="flex items-center gap-4 px-6 py-3 border-b border-gray-100 dark:border-gray-800 bg-gray-50 dark:bg-gray-900">
        <UFormField label="Write to column" class="w-64">
          <USelect
            v-model="categoryProperty"
            :items="writableProperties"
            placeholder="Select column..."
            value-key="value"
          />
        </UFormField>
        <UButton
          icon="i-lucide-plus"
          size="xs"
          variant="soft"
          @click="showCreateProperty = true"
        >
          New column
        </UButton>

        <USeparator orientation="vertical" class="h-8" />

        <!-- Filter popover -->
        <UPopover v-model:open="showFilterPopover">
          <UButton
            icon="i-lucide-filter"
            size="xs"
            :variant="activeFilterCount > 0 ? 'solid' : 'soft'"
            :color="activeFilterCount > 0 ? 'primary' : 'neutral'"
          >
            Filter{{ activeFilterCount > 0 ? ` (${activeFilterCount})` : '' }}
          </UButton>

          <template #content>
            <div class="p-4 w-72">
              <div class="flex items-center justify-between mb-3">
                <span class="text-sm font-semibold">Filter by column</span>
                <UButton
                  v-if="activeFilterCount > 0"
                  size="xs"
                  variant="link"
                  @click="clearAllFilters"
                >
                  Clear all
                </UButton>
              </div>

              <!-- Column picker -->
              <USelect
                v-model="activeFilterProperty"
                :items="filterableProperties.map(p => ({ label: `${p.name} (${p.type})`, value: p.name }))"
                placeholder="Select column..."
                value-key="value"
                class="mb-3"
              />

              <!-- Value checkboxes -->
              <div v-if="activeFilterProperty && activeFilterValues.length > 0" class="space-y-1 max-h-48 overflow-y-auto">
                <p class="text-xs text-gray-400 mb-2">Uncheck to hide cards with that value:</p>
                <label
                  v-for="val in activeFilterValues"
                  :key="val"
                  class="flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-gray-50 dark:hover:bg-gray-800 cursor-pointer text-sm"
                >
                  <input
                    type="checkbox"
                    :checked="!isValueHidden(activeFilterProperty!, val)"
                    class="rounded border-gray-300 text-primary-500 focus:ring-primary-500"
                    @change="toggleFilterValue(activeFilterProperty!, val)"
                  >
                  <span class="truncate">{{ val }}</span>
                  <span class="ml-auto text-xs text-gray-400">
                    {{ pages.filter(p => {
                      const v = p.properties[activeFilterProperty!]
                      return Array.isArray(v) ? v.includes(val) : String(v) === val
                    }).length }}
                  </span>
                </label>
              </div>
              <p v-else-if="activeFilterProperty" class="text-xs text-gray-400 py-2">
                No values found for this column.
              </p>

              <!-- Active filters summary -->
              <div v-if="activeFilterCount > 0" class="mt-3 pt-3 border-t border-gray-100 dark:border-gray-800">
                <p class="text-xs text-gray-400 mb-2">Hidden values (click to remove):</p>
                <div class="flex flex-wrap gap-1">
                  <UBadge
                    v-for="item in hiddenValuesList"
                    :key="`${item.property}-${item.value}`"
                    color="error"
                    variant="subtle"
                    size="xs"
                    class="cursor-pointer"
                    @click="toggleFilterValue(item.property, item.value)"
                  >
                    {{ item.property }}: {{ item.value }} &times;
                  </UBadge>
                </div>
              </div>
            </div>
          </template>
        </UPopover>

        <USeparator orientation="vertical" class="h-8" />

        <div class="flex items-center gap-2 flex-wrap">
          <span class="text-xs text-gray-500 uppercase tracking-wide">Groups:</span>
          <div
            v-for="group in groups"
            :key="group.id"
            class="flex items-center gap-1 px-2 py-1 rounded-md text-sm"
            :style="{ backgroundColor: group.color }"
          >
            <input
              v-if="editingGroupId === group.id"
              v-model="editingGroupName"
              class="bg-transparent border-none outline-none font-medium text-gray-700 w-24"
              @blur="commitRenameGroup"
              @keyup.enter="commitRenameGroup"
              @keyup.escape="editingGroupId = null"
              @vue:mounted="({ el }: any) => { el.focus(); el.select() }"
            >
            <span
              v-else
              class="font-medium text-gray-700 cursor-pointer"
              title="Double-click to rename"
              @dblclick="startRenameGroup(group.id)"
            >{{ group.name }}</span>
            <UButton
              icon="i-lucide-x"
              size="xs"
              variant="ghost"
              color="neutral"
              @click="removeGroup(group.id)"
            />
          </div>
          <UButton
            v-if="groups.length === 0"
            size="xs"
            variant="link"
            @click="showGroupModal = true"
          >
            Create your first group
          </UButton>
        </div>
      </div>

      <!-- CroutonFlow canvas -->
      <div class="flex-1 min-h-0">
        <ClientOnly>
          <CroutonFlow
            v-if="canvasFlowId"
            :key="canvasFlowId"
            v-model:rows="nodes"
            collection="categorize"
            data-mode="ephemeral"
            sync
            :flow-id="canvasFlowId"
            :node-type-components="nodeTypeComponents"
            :container-options="{ enabled: true }"
            :controls="true"
            :minimap="false"
            :fit-view-on-mount="true"
            @node-click="handleNodeClick"
            @node-container-change="handleContainerChange"
          />
          <CroutonFlow
            v-else
            v-model:rows="nodes"
            collection="categorize"
            data-mode="ephemeral"
            :node-type-components="nodeTypeComponents"
            :container-options="{ enabled: true }"
            :controls="true"
            :minimap="false"
            :fit-view-on-mount="true"
            @node-click="handleNodeClick"
            @node-container-change="handleContainerChange"
          />
        </ClientOnly>
      </div>
      </div>

      <!-- Insights tab -->
      <div v-show="activeTab === 'insights'" class="flex-1 overflow-y-auto p-6 space-y-6">
        <template v-if="hasRiceScores">
          <!-- Summary stats -->
          <div v-if="riceStats" class="grid grid-cols-4 gap-4">
            <div class="rounded-xl border border-gray-200 dark:border-gray-700 p-4 text-center">
              <div class="text-2xl font-bold text-primary">
                {{ riceStats.total }}
              </div>
              <div class="text-xs text-gray-500 mt-1">
                Cards with RICE
              </div>
            </div>
            <div class="rounded-xl border border-gray-200 dark:border-gray-700 p-4 text-center">
              <div class="text-2xl font-bold text-blue-600">
                {{ riceStats.avg }}
              </div>
              <div class="text-xs text-gray-500 mt-1">
                Average RICE
              </div>
            </div>
            <div class="rounded-xl border border-gray-200 dark:border-gray-700 p-4 text-center">
              <div class="text-2xl font-bold text-green-600">
                {{ riceStats.max }}
              </div>
              <div class="text-xs text-gray-500 mt-1">
                Highest RICE
              </div>
            </div>
            <div class="rounded-xl border border-gray-200 dark:border-gray-700 p-4 text-center">
              <div class="text-2xl font-bold text-red-500">
                {{ riceStats.min }}
              </div>
              <div class="text-xs text-gray-500 mt-1">
                Lowest RICE
              </div>
            </div>
          </div>

          <!-- Charts row -->
          <div class="grid grid-cols-2 gap-6">
            <!-- RICE Score ranking -->
            <div class="rounded-xl border border-gray-200 dark:border-gray-700 p-4">
              <h3 class="text-sm font-semibold mb-3">
                RICE Score Ranking
              </h3>
              <ClientOnly>
                <BarChart
                  v-if="riceBarData.length > 0"
                  :data="riceBarData"
                  :y-axis="['RICE']"
                  :categories="riceBarCategories"
                  :x-formatter="(_: number, i = 0) => String(riceBarData[i]?.name ?? '')"
                  :height="Math.max(250, riceBarData.length * 28)"
                />
              </ClientOnly>
            </div>

            <!-- RICE components breakdown -->
            <div class="rounded-xl border border-gray-200 dark:border-gray-700 p-4">
              <h3 class="text-sm font-semibold mb-3">
                RICE Components
              </h3>
              <ClientOnly>
                <BarChart
                  v-if="riceComponentsData.length > 0"
                  :data="riceComponentsData"
                  :y-axis="['Reach', 'Impact', 'Confidence', 'Effort']"
                  :categories="riceComponentCategories"
                  :x-formatter="(_: number, i = 0) => String(riceComponentsData[i]?.name ?? '')"
                  :height="Math.max(250, riceComponentsData.length * 28)"
                  :stacked="true"
                />
              </ClientOnly>
            </div>
          </div>

          <!-- Category breakdown -->
          <div v-if="riceByCategoryData.length > 0" class="rounded-xl border border-gray-200 dark:border-gray-700 p-4">
            <h3 class="text-sm font-semibold mb-3">
              Average RICE by Category
            </h3>
            <div class="grid grid-cols-2 gap-6">
              <ClientOnly>
                <BarChart
                  :data="riceByCategoryData.map(d => ({ name: d.name, 'Avg RICE': d.avgRice }))"
                  :y-axis="['Avg RICE']"
                  :categories="{ 'Avg RICE': { name: 'Avg RICE', color: '#8b5cf6' } }"
                  :x-formatter="(_: number, i = 0) => String(riceByCategoryData[i]?.name ?? '')"
                  :height="250"
                />
              </ClientOnly>
              <div class="space-y-2">
                <div
                  v-for="cat in riceByCategoryData"
                  :key="cat.name"
                  class="flex items-center justify-between p-3 rounded-lg bg-gray-50 dark:bg-gray-800"
                >
                  <div>
                    <div class="font-medium text-sm">
                      {{ cat.name }}
                    </div>
                    <div class="text-xs text-gray-500">
                      {{ cat.count }} cards
                    </div>
                  </div>
                  <div class="text-right">
                    <div class="font-bold text-lg">
                      {{ cat.avgRice }}
                    </div>
                    <div class="text-xs text-gray-400">
                      avg RICE
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <!-- Sorted card table -->
          <div class="rounded-xl border border-gray-200 dark:border-gray-700 p-4">
            <h3 class="text-sm font-semibold mb-3">
              All Cards by RICE Score
            </h3>
            <div class="overflow-auto max-h-96">
              <table class="w-full text-sm">
                <thead>
                  <tr class="border-b border-gray-200 dark:border-gray-700 text-left">
                    <th class="py-2 pr-4 font-medium text-gray-500">#</th>
                    <th class="py-2 pr-4 font-medium text-gray-500">Title</th>
                    <th class="py-2 pr-4 font-medium text-gray-500 text-right">Reach</th>
                    <th class="py-2 pr-4 font-medium text-gray-500 text-right">Impact</th>
                    <th class="py-2 pr-4 font-medium text-gray-500 text-right">Confidence</th>
                    <th class="py-2 pr-4 font-medium text-gray-500 text-right">Effort</th>
                    <th class="py-2 font-medium text-gray-500 text-right">RICE</th>
                  </tr>
                </thead>
                <tbody>
                  <tr
                    v-for="(page, i) in pagesByRice"
                    :key="page.id"
                    class="border-b border-gray-100 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800/50 cursor-pointer"
                    @click="selectedCard = { title: page.title, properties: page.properties, url: page.url, createdTime: page.createdTime, lastEditedTime: page.lastEditedTime, createdBy: page.createdBy, lastEditedBy: page.lastEditedBy }; showCardDetail = true"
                  >
                    <td class="py-2 pr-4 text-gray-400">{{ i + 1 }}</td>
                    <td class="py-2 pr-4 font-medium max-w-xs truncate">{{ page.title }}</td>
                    <td class="py-2 pr-4 text-right">{{ getRiceField(page.properties, 'Reach') ?? '-' }}</td>
                    <td class="py-2 pr-4 text-right">{{ getRiceField(page.properties, 'Impact') ?? '-' }}</td>
                    <td class="py-2 pr-4 text-right">{{ getRiceField(page.properties, 'Confidence') ?? '-' }}</td>
                    <td class="py-2 pr-4 text-right">{{ getRiceField(page.properties, 'Effort') ?? '-' }}</td>
                    <td class="py-2 text-right font-bold" :class="(page.rice ?? 0) >= 10 ? 'text-green-600' : (page.rice ?? 0) >= 5 ? 'text-amber-600' : 'text-red-500'">
                      {{ Math.round(page.rice ?? 0) }}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </template>

        <!-- No RICE scores -->
        <div v-else class="flex flex-col items-center justify-center h-full text-center">
          <UIcon name="i-lucide-chart-bar" class="size-16 mb-4 opacity-20" />
          <h3 class="text-lg font-semibold mb-1">
            No RICE scores found
          </h3>
          <p class="text-sm text-gray-500 max-w-md">
            Add Reach, Impact, Confidence, and Effort number fields to your Notion database to see RICE score visualizations.
          </p>
        </div>
      </div>
        </template>
      </div>
    </template>

    <!-- Empty state -->
    <template #empty>
      <div class="flex-1 flex items-center justify-center text-muted">
        <div class="text-center max-w-md px-6">
          <div class="size-16 rounded-2xl bg-muted/50 flex items-center justify-center mx-auto mb-4">
            <UIcon name="i-lucide-layout-grid" class="size-8 text-muted" />
          </div>
          <h3 class="text-lg font-semibold mb-2">Notion Categorizer</h3>
          <p class="text-sm text-muted mb-6">
            Select a saved layout from the sidebar, or create a new one to pull cards from Notion and group them visually.
          </p>
          <UButton color="primary" icon="i-lucide-plus" @click="handleCreateLayout">
            New Layout
          </UButton>
        </div>
      </div>
    </template>
  </CroutonWorkspaceLayout>

    <!-- Card detail slideover -->
    <USlideover v-model:open="showCardDetail">
      <template #content>
        <div v-if="selectedCard" class="h-full flex flex-col overflow-hidden">
          <!-- Fixed header -->
          <div class="p-6 pb-4 border-b border-gray-200 dark:border-gray-700 shrink-0">
            <div class="flex items-start justify-between gap-3">
              <h2 class="text-lg font-semibold leading-snug">
                {{ selectedCard.title }}
              </h2>
              <UButton
                icon="i-lucide-external-link"
                size="xs"
                variant="ghost"
                :to="selectedCard.url"
                target="_blank"
              />
            </div>

            <!-- Status + Type badges -->
            <div class="flex flex-wrap gap-2 mt-3">
              <UBadge v-if="selectedCard.properties.Status || selectedCard.properties.status" color="primary" variant="subtle" size="sm">
                {{ selectedCard.properties.Status || selectedCard.properties.status }}
              </UBadge>
              <UBadge v-if="selectedCard.properties.Type || selectedCard.properties.type" color="neutral" variant="subtle" size="sm">
                {{ selectedCard.properties.Type || selectedCard.properties.type }}
              </UBadge>
              <UBadge v-if="selectedCard.properties.Category || selectedCard.properties.category" color="info" variant="subtle" size="sm">
                {{ selectedCard.properties.Category || selectedCard.properties.category }}
              </UBadge>
            </div>
          </div>

          <!-- Scrollable body -->
          <div class="flex-1 overflow-y-auto p-6 space-y-5">
            <!-- RICE score card -->
            <div v-if="cardRice" class="rounded-xl bg-gray-50 dark:bg-gray-800 p-4">
              <div class="flex items-center justify-between mb-3">
                <span class="text-sm font-semibold">RICE Score</span>
                <span
                  class="text-2xl font-bold"
                  :class="cardRice.score >= 10 ? 'text-green-600' : cardRice.score >= 5 ? 'text-amber-600' : 'text-red-500'"
                >
                  {{ cardRice.score }}
                </span>
              </div>
              <div class="grid grid-cols-4 gap-3">
                <div v-for="comp in cardRice.components" :key="comp.label" class="text-center">
                  <div class="text-lg font-semibold">
                    {{ comp.value ?? '-' }}
                  </div>
                  <div class="text-[10px] text-gray-500 uppercase tracking-wider">
                    {{ comp.label }}
                  </div>
                  <div class="mt-1 h-1.5 rounded-full bg-gray-200 dark:bg-gray-700 overflow-hidden">
                    <div
                      class="h-full rounded-full transition-all"
                      :class="comp.color"
                      :style="{ width: `${Math.min(100, ((comp.value ?? 0) / comp.max) * 100)}%` }"
                    />
                  </div>
                </div>
              </div>
              <!-- Mini bar chart for RICE components -->
              <ClientOnly>
                <BarChart
                  v-if="cardRice.chartData.length > 0"
                  :data="cardRice.chartData"
                  :y-axis="['Value']"
                  :categories="{ Value: { name: 'Value', color: '#6366f1' } }"
                  :x-formatter="(_: number, i = 0) => String(cardRice?.chartData[i]?.name ?? '')"
                  :height="120"
                  class="mt-3"
                />
              </ClientOnly>
            </div>

            <!-- Created / edited metadata -->
            <div v-if="selectedCard.createdTime || selectedCard.createdBy" class="flex flex-wrap gap-x-6 gap-y-2 text-xs text-gray-400">
              <div v-if="selectedCard.createdBy?.name || selectedCard.createdTime" class="flex items-center gap-1.5">
                <UIcon name="i-lucide-user" class="size-3.5" />
                <span>
                  Created<template v-if="selectedCard.createdBy?.name"> by <span class="text-gray-600 dark:text-gray-300 font-medium">{{ selectedCard.createdBy.name }}</span></template><template v-if="selectedCard.createdTime"> on {{ new Date(selectedCard.createdTime).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) }}</template>
                </span>
              </div>
              <div v-if="selectedCard.lastEditedBy?.name || selectedCard.lastEditedTime" class="flex items-center gap-1.5">
                <UIcon name="i-lucide-pencil" class="size-3.5" />
                <span>
                  Edited<template v-if="selectedCard.lastEditedBy?.name"> by <span class="text-gray-600 dark:text-gray-300 font-medium">{{ selectedCard.lastEditedBy.name }}</span></template><template v-if="selectedCard.lastEditedTime"> on {{ new Date(selectedCard.lastEditedTime).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) }}</template>
                </span>
              </div>
            </div>

            <!-- Properties (filtered, no empties) -->
            <div class="space-y-2">
              <template v-for="(value, key) in cardFilteredProperties" :key="key">
                <div class="flex items-start gap-3 py-2 border-b border-gray-100 dark:border-gray-800 last:border-0">
                  <span class="text-xs font-medium text-gray-400 uppercase tracking-wide w-28 shrink-0 pt-0.5">{{ key }}</span>
                  <div class="flex-1 min-w-0">
                    <template v-if="Array.isArray(value) && value.length > 0">
                      <div class="flex flex-wrap gap-1">
                        <UBadge
                          v-for="(item, i) in value"
                          :key="i"
                          variant="subtle"
                          size="xs"
                        >
                          {{ item }}
                        </UBadge>
                      </div>
                    </template>
                    <template v-else-if="value === true || value === false">
                      <UBadge :color="value ? 'success' : 'neutral'" variant="subtle" size="xs">
                        {{ value ? 'Yes' : 'No' }}
                      </UBadge>
                    </template>
                    <template v-else-if="typeof value === 'number'">
                      <span class="text-sm font-medium">{{ value }}</span>
                    </template>
                    <template v-else>
                      <span class="text-sm">{{ value }}</span>
                    </template>
                  </div>
                </div>
              </template>
            </div>
          </div>
        </div>
      </template>
    </USlideover>

    <!-- Create Notion property modal -->
    <UModal v-model:open="showCreateProperty">
      <template #content="{ close }">
        <div class="p-6">
          <h3 class="text-lg font-semibold mb-4">
            Create Notion Column
          </h3>
          <p class="text-sm text-gray-500 mb-4">
            Creates a new select property in your Notion database.
          </p>
          <UFormField label="Column name">
            <UInput
              v-model="newPropertyName"
              placeholder="e.g., Category"
              autofocus
              @keyup.enter="createNotionProperty"
            />
          </UFormField>
          <div v-if="allProperties.length > 0" class="mt-4">
            <p class="text-xs text-gray-400 mb-2">Existing columns:</p>
            <div class="flex flex-wrap gap-1">
              <UBadge
                v-for="prop in allProperties"
                :key="prop.value"
                :color="prop.disabled ? 'neutral' : 'primary'"
                variant="subtle"
                size="xs"
              >
                {{ prop.label }}
              </UBadge>
            </div>
          </div>
          <div class="flex justify-end gap-2 mt-6">
            <UButton color="neutral" variant="ghost" @click="close">
              Cancel
            </UButton>
            <UButton :disabled="!newPropertyName.trim()" :loading="creatingProperty" @click="createNotionProperty">
              Create
            </UButton>
          </div>
        </div>
      </template>
    </UModal>

    <!-- Add group modal -->
    <UModal v-model:open="showGroupModal">
      <template #content="{ close }">
        <div class="p-6">
          <h3 class="text-lg font-semibold mb-4">
            Create Group
          </h3>
          <p class="text-sm text-gray-500 mb-4">
            Groups become category values when saving to Notion.
          </p>
          <UFormField label="Group name">
            <UInput
              v-model="newGroupName"
              placeholder="e.g., Design, Engineering, Marketing..."
              autofocus
              @keyup.enter="createGroup"
            />
          </UFormField>
          <div class="flex justify-end gap-2 mt-6">
            <UButton color="neutral" variant="ghost" @click="close">
              Cancel
            </UButton>
            <UButton :disabled="!newGroupName.trim()" @click="createGroup">
              Create
            </UButton>
          </div>
        </div>
      </template>
    </UModal>

    <!-- Connect Notion Account modal -->
    <UModal v-model:open="showConnectModal">
      <template #content="{ close }">
        <div class="p-6">
          <h3 class="text-lg font-semibold mb-4">
            Connect Notion Account
          </h3>
          <div class="space-y-4">
            <UFormField label="Label" required>
              <UInput
                v-model="connectLabel"
                placeholder="e.g., Design Team Notion"
                autofocus
              />
            </UFormField>
            <UFormField label="API Token" required>
              <UInput
                v-model="connectToken"
                placeholder="secret_... or ntn_..."
                type="password"
              />
              <template #description>
                Paste your Notion integration token. It will be encrypted at rest.
              </template>
            </UFormField>
          </div>
          <div class="flex justify-end gap-2 mt-6">
            <UButton color="neutral" variant="ghost" @click="close">
              Cancel
            </UButton>
            <UButton
              :disabled="!connectLabel.trim() || !connectToken.trim()"
              :loading="connecting"
              @click="connectNotionAccount"
            >
              Connect
            </UButton>
          </div>
        </div>
      </template>
    </UModal>
</template>

<style scoped>
.group-node-label {
  position: absolute;
  top: 8px;
  left: 12px;
  font-size: 14px;
  font-weight: 600;
  color: #4b5563;
  pointer-events: none;
  user-select: none;
}
</style>
