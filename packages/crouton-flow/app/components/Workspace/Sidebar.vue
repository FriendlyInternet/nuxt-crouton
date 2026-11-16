<script setup lang="ts">
/**
 * Flow Workspace Sidebar - Searchable list of flow configs
 *
 * Lists saved flows for the team with search, badges, and context menus.
 */

interface Props {
  selectedId?: string | null
}

const props = withDefaults(defineProps<Props>(), {
  selectedId: null,
})

const emit = defineEmits<{
  select: [flow: any]
  create: []
}>()

const { t } = useI18n()
const { teamId } = useTeamContext()

// Gate on teamId: skip the initial request until a team is in context, then
// the reactive URL key drives the fetch once teamId resolves.
const { data: flows, pending, refresh } = await useFetch(
  () => `/api/crouton-flow/teams/${teamId.value}/flows`,
  { default: () => [] as any[], enabled: () => !!teamId.value }
)

// Search
const searchQuery = ref('')
const searchInputRef = ref<{ inputRef?: { el?: HTMLElement } } | null>(null)

const filteredFlows = computed(() => {
  if (!searchQuery.value.trim()) return flows.value
  const query = searchQuery.value.toLowerCase()
  return flows.value.filter((flow: any) =>
    flow.name?.toLowerCase().includes(query) ||
    flow.collection?.toLowerCase().includes(query)
  )
})

// Delete
const deletingId = ref<string | null>(null)

async function handleDelete(flowId: string) {
  deletingId.value = flowId
  try {
    await $fetch(`/api/crouton-flow/teams/${teamId.value}/flows/${flowId}`, {
      method: 'DELETE',
    })
    await refresh()
    // If we deleted the selected flow, notify parent
    if (props.selectedId === flowId) {
      emit('select', { id: null })
    }
  } finally {
    deletingId.value = null
  }
}

function focusSearch() {
  searchInputRef.value?.inputRef?.el?.focus()
}

defineExpose({ focusSearch, refresh })
</script>

<template>
  <div class="flex flex-col h-full">
    <!-- Search -->
    <div class="flex items-center gap-2 min-h-14 px-4 py-3 border-b border-default bg-elevated/30">
      <UInput
        ref="searchInputRef"
        v-model="searchQuery"
        icon="i-lucide-search"
        :placeholder="$t('flow.sidebar.search')"
        size="sm"
        class="flex-1"
      />
    </div>

    <!-- Loading -->
    <div v-if="pending" class="p-3 space-y-2">
      <USkeleton class="h-12 w-full" />
      <USkeleton class="h-12 w-full" />
      <USkeleton class="h-12 w-full" />
    </div>

    <!-- Empty -->
    <div
      v-else-if="!filteredFlows.length"
      class="p-6 text-center text-muted flex-1"
    >
      <UIcon name="i-lucide-share-2" class="size-8 mb-2 opacity-50" />
      <p class="text-sm">
        {{ searchQuery ? t('flow.sidebar.noResults') : t('flow.sidebar.empty') }}
      </p>
      <UButton
        v-if="!searchQuery"
        size="sm"
        color="primary"
        variant="soft"
        class="mt-3"
        @click="emit('create')"
      >
        {{ $t('flow.actions.create') }}
      </UButton>
    </div>

    <!-- Flow list -->
    <div v-else class="flex-1 overflow-auto">
      <ul role="list" class="divide-y divide-default">
        <li
          v-for="flow in filteredFlows"
          :key="flow.id"
          class="group px-4 py-3 cursor-pointer transition-colors"
          :class="[
            selectedId === flow.id
              ? 'bg-primary/10 border-l-2 border-primary'
              : 'hover:bg-muted/50 border-l-2 border-transparent'
          ]"
          @click="emit('select', flow)"
        >
          <div class="flex items-center gap-2.5 min-w-0">
            <div class="size-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
              <UIcon name="i-lucide-share-2" class="size-3.5 text-primary" />
            </div>
            <div class="flex-1 min-w-0">
              <p class="text-sm font-medium text-default truncate">{{ flow.name }}</p>
              <div class="flex items-center gap-1.5 mt-0.5">
                <span class="text-xs text-muted truncate">{{ flow.collection }}</span>
                <UIcon
                  v-if="flow.syncEnabled"
                  name="i-lucide-radio"
                  class="size-3 text-success shrink-0"
                />
              </div>
            </div>
            <UDropdownMenu
              :items="[
                [{ label: t('flow.actions.delete'), icon: 'i-lucide-trash-2', color: 'error' as const, loading: deletingId === flow.id, onSelect: () => handleDelete(flow.id) }]
              ]"
              :content="{ align: 'end' as const }"
            >
              <UButton
                size="xs"
                color="neutral"
                variant="ghost"
                icon="i-lucide-ellipsis"
                class="opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
                @click.stop
              />
            </UDropdownMenu>
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
        @click="emit('create')"
      >
        {{ t('flow.actions.new') }}
      </UButton>
    </div>
  </div>
</template>
