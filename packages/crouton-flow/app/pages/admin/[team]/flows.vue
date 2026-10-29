<script setup lang="ts">
/**
 * Flows Workspace - Split-panel flow manager
 *
 * Uses CroutonWorkspaceLayout for the split-panel shell.
 * Left: searchable flow list. Right: CroutonFlow canvas.
 */

definePageMeta({
  layout: 'admin',
  middleware: ['auth']
})

const { t } = useI18n()
const { teamId, teamSlug } = useTeamContext()

// Collection registry for smart form fields
const { configs: collectionConfigs } = useCollections()

const collectionItems = computed(() =>
  Object.entries(collectionConfigs).map(([key, config]) => ({
    label: config.displayName || config.name || key,
    value: config.apiPath?.split('/').pop() || key,
    key,
    fields: config.fields || []
  }))
)

// Get fields for a given collection API path
function getFieldsForCollection(collectionApiSlug: string) {
  const match = collectionItems.value.find(c => c.value === collectionApiSlug)
  return match?.fields || []
}

function getFieldOptions(collectionApiSlug: string) {
  const fields = getFieldsForCollection(collectionApiSlug)
  return fields.map(f => ({ label: f.label || f.name, value: f.name }))
}

// Auto-detect best defaults for field mapping when collection changes
function autoDetectFieldMapping(collectionApiSlug: string) {
  const fields = getFieldsForCollection(collectionApiSlug)
  const names = fields.map(f => f.name)
  return {
    labelField: names.find(n => ['title', 'name', 'label'].includes(n)) || 'title',
    parentField: names.find(n => ['parentId', 'parent_id', 'parent'].includes(n)) || 'parentId',
    positionField: names.find(n => ['position', 'order', 'sortOrder'].includes(n)) || 'position',
  }
}

// Selected flow ID — synced with WorkspaceLayout via v-model
const selectedFlowId = ref<string | null>(null)

// Workspace layout ref
const layoutRef = ref<{ select: (item: any) => void; create: () => void; focusSearch: () => void } | null>(null)

// Sidebar ref for refresh after create
const sidebarRef = ref<{ refresh: () => Promise<void>; focusSearch: () => void } | null>(null)

// Fetch selected flow config — gated until a flow is selected; the reactive
// URL key then drives (re)fetches as the selection changes.
const { data: flow, pending: flowPending, refresh: refreshFlow } = await useFetch(
  () => selectedFlowId.value && teamId.value
    ? `/api/crouton-flow/teams/${teamId.value}/flows/${selectedFlowId.value}`
    : '',
  {
    default: () => null as any,
    immediate: !!(selectedFlowId.value && teamId.value),
    watch: [selectedFlowId]
  }
)

// Fetch collection rows when not in sync mode — gated until a non-sync flow
// is loaded (the empty branch also avoids dereferencing a null flow).
const { data: rows, pending: rowsPending } = await useFetch<Record<string, unknown>[]>(
  () => flow.value && !flow.value.syncEnabled && teamId.value
    ? `/api/teams/${teamId.value}/${flow.value.collection}`
    : '',
  {
    default: () => [] as any[],
    immediate: !!(flow.value && !flow.value.syncEnabled && teamId.value),
    watch: [flow]
  }
)

const loading = computed(() => flowPending.value || rowsPending.value)

// Create modal
const isCreateOpen = ref(false)
const createForm = reactive({
  name: '',
  description: '',
  collection: '',
  labelField: 'title',
  parentField: 'parentId',
  positionField: 'position',
  syncEnabled: false,
})
const createPending = ref(false)

// Auto-detect field mappings when collection changes
watch(() => createForm.collection, (newCollection) => {
  if (newCollection) {
    const defaults = autoDetectFieldMapping(newCollection)
    createForm.labelField = defaults.labelField
    createForm.parentField = defaults.parentField
    createForm.positionField = defaults.positionField
  }
})

const createFieldOptions = computed(() => getFieldOptions(createForm.collection))

function openCreate() {
  isCreateOpen.value = true
}

async function handleCreate() {
  if (!createForm.name.trim() || !createForm.collection) return
  createPending.value = true
  try {
    const created = await $fetch<any>(`/api/crouton-flow/teams/${teamId.value}/flows`, {
      method: 'POST',
      body: {
        name: createForm.name,
        description: createForm.description,
        collection: createForm.collection,
        labelField: createForm.labelField,
        parentField: createForm.parentField,
        positionField: createForm.positionField,
        syncEnabled: createForm.syncEnabled,
      },
    })
    isCreateOpen.value = false
    Object.assign(createForm, {
      name: '',
      description: '',
      collection: '',
      labelField: 'title',
      parentField: 'parentId',
      positionField: 'position',
      syncEnabled: false,
    })
    // Refresh sidebar list and select the new flow
    if (typeof sidebarRef.value?.refresh === 'function') {
      await sidebarRef.value.refresh()
    }
    if (created?.id) {
      layoutRef.value?.select(created)
    }
  } finally {
    createPending.value = false
  }
}

// Edit modal
const isEditOpen = ref(false)
const editForm = reactive({
  name: '',
  description: '',
  collection: '',
  labelField: 'title',
  parentField: 'parentId',
  positionField: 'position',
  syncEnabled: false,
})
const editPending = ref(false)
const editFieldOptions = computed(() => getFieldOptions(editForm.collection))

function openEdit() {
  if (!flow.value) return
  Object.assign(editForm, {
    name: flow.value.name,
    description: flow.value.description ?? '',
    collection: flow.value.collection,
    labelField: flow.value.labelField ?? 'title',
    parentField: flow.value.parentField ?? 'parentId',
    positionField: flow.value.positionField ?? 'position',
    syncEnabled: flow.value.syncEnabled ?? false,
  })
  isEditOpen.value = true
}

async function handleEdit() {
  if (!flow.value || !selectedFlowId.value) return
  editPending.value = true
  try {
    await $fetch(`/api/crouton-flow/teams/${teamId.value}/flows/${selectedFlowId.value}`, {
      method: 'PATCH',
      body: {
        name: editForm.name,
        description: editForm.description,
        collection: editForm.collection,
        labelField: editForm.labelField,
        parentField: editForm.parentField,
        positionField: editForm.positionField,
        syncEnabled: editForm.syncEnabled,
      },
    })
    await refreshFlow()
    if (typeof sidebarRef.value?.refresh === 'function') {
      await sidebarRef.value.refresh()
    }
    isEditOpen.value = false
  } finally {
    editPending.value = false
  }
}
</script>

<template>
  <CroutonWorkspaceLayout
    ref="layoutRef"
    v-model="selectedFlowId"
    query-param="flow"
    :title="$t('flow.admin.flows')"
    sidebar-id="flows-sidebar"
  >
    <template #sidebar-actions>
      <UButton
        color="primary"
        variant="ghost"
        icon="i-lucide-plus"
        size="sm"
        @click="openCreate"
      />
    </template>

    <template #sidebar="{ selectedId }">
      <CroutonFlowWorkspaceSidebar
        ref="sidebarRef"
        :selected-id="selectedId"
        @select="(flow: any) => layoutRef?.select(flow)"
        @create="openCreate"
      />
    </template>

    <template #content="{ selectedId }">
      <div class="h-full flex flex-col">
        <!-- Toolbar -->
        <div class="flex items-center gap-3 px-4 py-2.5 border-b border-default bg-default shrink-0">
          <template v-if="flow">
            <div class="flex items-center gap-2 min-w-0">
              <UIcon name="i-lucide-share-2" class="size-4 text-primary shrink-0" />
              <span class="font-medium text-highlighted truncate">{{ flow.name }}</span>
              <UBadge color="neutral" variant="soft" size="xs">{{ flow.collection }}</UBadge>
              <UBadge v-if="flow.syncEnabled" color="success" variant="soft" size="xs">
                <UIcon name="i-lucide-radio" class="size-3 mr-1" />
                {{ $t('flow.status.live') }}
              </UBadge>
            </div>

            <div class="ml-auto flex items-center gap-2">
              <UButton
                size="sm"
                color="neutral"
                variant="ghost"
                icon="i-lucide-settings"
                @click="openEdit"
              >
                {{ $t('flow.actions.configure') }}
              </UButton>
            </div>
          </template>
        </div>

        <!-- Canvas -->
        <div class="flex-1 min-h-0">
          <div v-if="loading" class="h-full flex items-center justify-center">
            <UIcon name="i-lucide-loader-2" class="size-6 text-muted animate-spin" />
          </div>

          <div v-else-if="!flow" class="h-full flex items-center justify-center text-center">
            <div>
              <p class="font-medium text-highlighted">{{ $t('flow.errors.notFound') }}</p>
            </div>
          </div>

          <CroutonFlow
            v-else-if="flow.syncEnabled"
            :collection="flow.collection"
            :label-field="flow.labelField ?? 'title'"
            :parent-field="flow.parentField ?? 'parentId'"
            :position-field="flow.positionField ?? 'position'"
            sync
            :flow-id="selectedId!"
            :minimap="true"
            class="h-full w-full"
          />

          <CroutonFlow
            v-else
            :rows="rows"
            :collection="flow.collection"
            :label-field="flow.labelField ?? 'title'"
            :parent-field="flow.parentField ?? 'parentId'"
            :position-field="flow.positionField ?? 'position'"
            :flow-id="selectedId!"
            :saved-positions="flow.nodePositions"
            :minimap="true"
            class="h-full w-full"
          />
        </div>
      </div>
    </template>

    <template #empty>
      <div class="flex-1 flex items-center justify-center text-muted">
        <div class="text-center max-w-md px-6">
          <div class="size-16 rounded-2xl bg-muted/50 flex items-center justify-center mx-auto mb-4">
            <UIcon name="i-lucide-share-2" class="size-8 text-muted" />
          </div>
          <h3 class="text-lg font-semibold mb-2">{{ $t('flow.placeholder.title') }}</h3>
          <p class="text-sm text-muted mb-6">
            {{ $t('flow.placeholder.description') }}
          </p>
          <UButton color="primary" icon="i-lucide-plus" @click="openCreate">
            {{ $t('flow.actions.createNew') }}
          </UButton>
        </div>
      </div>
    </template>
  </CroutonWorkspaceLayout>

  <!-- Create modal -->
  <UModal v-model:open="isCreateOpen" :title="$t('flow.modal.newTitle')">
    <template #body>
      <div class="flex flex-col gap-4">
        <UFormField :label="$t('flow.fields.name')" required>
          <UInput v-model="createForm.name" :placeholder="$t('flow.fields.namePlaceholder')" class="w-full" />
        </UFormField>

        <UFormField :label="$t('flow.fields.description')">
          <UInput v-model="createForm.description" :placeholder="$t('flow.fields.descriptionPlaceholder')" class="w-full" />
        </UFormField>

        <UFormField :label="$t('flow.fields.collection')" required :hint="$t('flow.fields.collectionHint')">
          <USelectMenu
            v-model="createForm.collection"
            :items="collectionItems"
            value-key="value"
            :placeholder="$t('flow.fields.collectionPlaceholder')"
            class="w-full"
          />
        </UFormField>

        <USeparator />

        <p class="text-xs font-medium text-muted uppercase tracking-wide">{{ $t('flow.fields.fieldMapping') }}</p>

        <div class="grid grid-cols-3 gap-3">
          <UFormField :label="$t('flow.fields.labelField')">
            <USelectMenu
              v-if="createFieldOptions.length"
              v-model="createForm.labelField"
              :items="createFieldOptions"
              value-key="value"
              class="w-full"
            />
            <UInput v-else v-model="createForm.labelField" class="w-full" />
          </UFormField>
          <UFormField :label="$t('flow.fields.parentField')">
            <USelectMenu
              v-if="createFieldOptions.length"
              v-model="createForm.parentField"
              :items="createFieldOptions"
              value-key="value"
              class="w-full"
            />
            <UInput v-else v-model="createForm.parentField" class="w-full" />
          </UFormField>
          <UFormField :label="$t('flow.fields.positionField')">
            <USelectMenu
              v-if="createFieldOptions.length"
              v-model="createForm.positionField"
              :items="createFieldOptions"
              value-key="value"
              class="w-full"
            />
            <UInput v-else v-model="createForm.positionField" class="w-full" />
          </UFormField>
        </div>

        <UFormField :label="$t('flow.fields.liveSync')">
          <div class="flex items-center gap-2">
            <USwitch v-model="createForm.syncEnabled" />
            <span class="text-sm text-muted">{{ $t('flow.fields.liveSyncDescription') }}</span>
          </div>
        </UFormField>
      </div>
    </template>

    <template #footer>
      <div class="flex justify-end gap-2">
        <UButton color="neutral" variant="ghost" @click="isCreateOpen = false">{{ $t('flow.common.cancel') }}</UButton>
        <UButton
          :loading="createPending"
          :disabled="!createForm.name.trim() || !createForm.collection"
          icon="i-lucide-plus"
          @click="handleCreate"
        >
          {{ $t('flow.actions.create') }}
        </UButton>
      </div>
    </template>
  </UModal>

  <!-- Edit modal -->
  <UModal v-model:open="isEditOpen" :title="$t('flow.modal.configureTitle')">
    <template #body>
      <div class="flex flex-col gap-4">
        <UFormField :label="$t('flow.fields.name')" required>
          <UInput v-model="editForm.name" class="w-full" />
        </UFormField>

        <UFormField :label="$t('flow.fields.description')">
          <UInput v-model="editForm.description" class="w-full" />
        </UFormField>

        <UFormField :label="$t('flow.fields.collection')" required>
          <USelectMenu
            v-model="editForm.collection"
            :items="collectionItems"
            value-key="value"
            :placeholder="$t('flow.fields.collectionPlaceholder')"
            class="w-full"
          />
        </UFormField>

        <USeparator />

        <p class="text-xs font-medium text-muted uppercase tracking-wide">{{ $t('flow.fields.fieldMapping') }}</p>

        <div class="grid grid-cols-3 gap-3">
          <UFormField :label="$t('flow.fields.labelField')">
            <USelectMenu
              v-if="editFieldOptions.length"
              v-model="editForm.labelField"
              :items="editFieldOptions"
              value-key="value"
              class="w-full"
            />
            <UInput v-else v-model="editForm.labelField" class="w-full" />
          </UFormField>
          <UFormField :label="$t('flow.fields.parentField')">
            <USelectMenu
              v-if="editFieldOptions.length"
              v-model="editForm.parentField"
              :items="editFieldOptions"
              value-key="value"
              class="w-full"
            />
            <UInput v-else v-model="editForm.parentField" class="w-full" />
          </UFormField>
          <UFormField :label="$t('flow.fields.positionField')">
            <USelectMenu
              v-if="editFieldOptions.length"
              v-model="editForm.positionField"
              :items="editFieldOptions"
              value-key="value"
              class="w-full"
            />
            <UInput v-else v-model="editForm.positionField" class="w-full" />
          </UFormField>
        </div>

        <UFormField :label="$t('flow.fields.liveSync')">
          <div class="flex items-center gap-2">
            <USwitch v-model="editForm.syncEnabled" />
            <span class="text-sm text-muted">{{ $t('flow.fields.liveSyncDescription') }}</span>
          </div>
        </UFormField>
      </div>
    </template>

    <template #footer>
      <div class="flex justify-end gap-2">
        <UButton color="neutral" variant="ghost" @click="isEditOpen = false">{{ $t('flow.common.cancel') }}</UButton>
        <UButton :loading="editPending" @click="handleEdit">{{ $t('flow.actions.save') }}</UButton>
      </div>
    </template>
  </UModal>
</template>
