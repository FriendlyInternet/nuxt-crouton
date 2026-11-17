<script setup lang="ts">
import { useMediaQuery, useMounted } from '@vueuse/core'
import type { FilterState } from '../types/events'

const props = withDefaults(defineProps<{
  modelValue: FilterState
  collections?: string[]
  users?: Array<{ id: string, name: string }>
}>(), {
  collections: () => [],
  users: () => []
})

const emit = defineEmits<{
  'update:modelValue': [value: FilterState]
}>()

const { t } = useI18n()
const appConfig = useAppConfig()

const ALL = 'all'

function update(patch: Partial<FilterState>) {
  emit('update:modelValue', { ...props.modelValue, ...patch })
}

const collectionItems = computed(() => [
  { label: t('events.filters.allCollections'), value: ALL },
  ...props.collections.map(name => ({
    label: eventCollectionLabel(name, appConfig.croutonCollections as Record<string, any> | undefined, t),
    value: name
  }))
])

const operationItems = computed(() => [
  { label: t('events.filters.allActions'), value: ALL },
  { label: t('events.operation.create'), value: 'create' },
  { label: t('events.operation.update'), value: 'update' },
  { label: t('events.operation.delete'), value: 'delete' }
])

const userItems = computed(() => [
  { label: t('events.filters.everyone'), value: ALL },
  ...props.users.map(u => ({ label: u.name, value: u.id }))
])

// Nuxt UI menus refuse an empty-string item value (it throws on open), so "all" is 'all'
// in the menu and `undefined` in the filter state.
const fromAll = (value: string | undefined) => (!value || value === ALL ? undefined : value)

const collectionName = computed({
  get: () => props.modelValue.collectionName || ALL,
  set: (value: string) => update({ collectionName: fromAll(value) })
})

const operation = computed({
  get: () => props.modelValue.operation || ALL,
  set: (value: string) => update({ operation: fromAll(value) as FilterState['operation'] })
})

const userId = computed({
  get: () => props.modelValue.userId || ALL,
  set: (value: string) => update({ userId: fromAll(value) })
})

// Period: 'all' or a number of days back (0 = today). Set through the tab's update event,
// not a watcher, so clearing filters can't re-emit a stale copy of the other filters.
const periodItems = computed(() => [
  { label: t('events.period.all'), value: 'all' },
  { label: t('events.period.today'), value: '0' },
  { label: t('events.period.last7'), value: '7' },
  { label: t('events.period.last30'), value: '30' },
  { label: t('events.period.last90'), value: '90' }
])

const period = ref<string>('all')

function setPeriod(next: string | number) {
  const value = String(next)
  period.value = value
  if (value === 'all') {
    update({ dateFrom: undefined, dateTo: undefined })
    return
  }
  const now = new Date()
  const from = new Date()
  from.setDate(now.getDate() - Number(value))
  from.setHours(0, 0, 0, 0)
  update({ dateFrom: from, dateTo: now })
}

const hasActiveFilters = computed(() => !!(
  props.modelValue.collectionName
  || props.modelValue.operation
  || props.modelValue.userId
  || props.modelValue.dateFrom
  || props.modelValue.dateTo
))

// Below `sm` (640px) there are no inline selects: the page header's "Filtres" button calls the
// exposed openDrawer(), and the three selects live in a bottom drawer.
// The server can't know the width and renders the desktop branch; `useMediaQuery` already matches
// on the client's first (hydrating) render, so Vue would hydrate the phone branch onto the
// server's desktop <div> and keep its inline selects. Hold `isPhone` false until mounted so
// hydration matches, then switch; meanwhile `hidden sm:flex` keeps the inline selects off phones.
const phoneQuery = useMediaQuery('(max-width: 639px)')
const mounted = useMounted()
const isPhone = computed(() => mounted.value && phoneQuery.value)
const drawerOpen = ref(false)

const activeFilterCount = computed(() => [
  props.modelValue.collectionName,
  props.modelValue.operation,
  props.modelValue.userId
].filter(Boolean).length)

function clearSelectFilters() {
  update({ collectionName: undefined, operation: undefined, userId: undefined })
}

function openDrawer() {
  drawerOpen.value = true
}

function clearFilters() {
  period.value = 'all'
  emit('update:modelValue', {
    collectionName: undefined,
    operation: undefined,
    userId: undefined,
    dateFrom: undefined,
    dateTo: undefined
  })
}

defineExpose({ openDrawer, activeFilterCount })
</script>

<template>
  <div class="crouton-activity-filters flex flex-col gap-3">
    <UDrawer
      v-model:open="drawerOpen"
      direction="bottom"
      :title="t('events.filters.open')"
    >
      <template #body>
        <div class="flex flex-col gap-3">
          <USelectMenu
            v-model="collectionName"
            :items="collectionItems"
            value-key="value"
            :search-input="false"
            icon="i-lucide-database"
            :aria-label="t('events.filters.collection')"
            class="w-full"
          />
          <USelectMenu
            v-model="operation"
            :items="operationItems"
            value-key="value"
            :search-input="false"
            icon="i-lucide-zap"
            :aria-label="t('events.filters.action')"
            class="w-full"
          />
          <USelectMenu
            v-if="users.length"
            v-model="userId"
            :items="userItems"
            value-key="value"
            :search-input="false"
            icon="i-lucide-user"
            :aria-label="t('events.filters.person')"
            class="w-full"
          />
          <UButton
            v-if="activeFilterCount"
            color="neutral"
            variant="ghost"
            icon="i-lucide-x"
            :label="t('events.filters.clearAll')"
            block
            @click="clearSelectFilters"
          />
        </div>
      </template>
    </UDrawer>

    <div
      v-if="!isPhone"
      class="crouton-activity-filters-inline hidden sm:flex flex-wrap items-center gap-2"
    >
      <USelectMenu
        v-model="collectionName"
        :items="collectionItems"
        value-key="value"
        :search-input="false"
        icon="i-lucide-database"
        :aria-label="t('events.filters.collection')"
        class="w-52"
      />
      <USelectMenu
        v-model="operation"
        :items="operationItems"
        value-key="value"
        :search-input="false"
        icon="i-lucide-zap"
        :aria-label="t('events.filters.action')"
        class="w-44"
      />
      <USelectMenu
        v-if="users.length"
        v-model="userId"
        :items="userItems"
        value-key="value"
        :search-input="false"
        icon="i-lucide-user"
        :aria-label="t('events.filters.person')"
        class="w-48"
      />
    </div>

    <!-- Phone: the period bar is full width, its five segments share it equally (pill triggers grow) -->
    <div class="flex flex-wrap items-center justify-between gap-2">
      <UTabs
        :model-value="period"
        :items="periodItems"
        :content="false"
        size="xs"
        :aria-label="t('events.filters.period')"
        :ui="{ list: 'w-full', trigger: 'basis-0 sm:basis-auto' }"
        class="crouton-activity-period w-full sm:w-auto"
        @update:model-value="setPeriod"
      />
      <UButton
        v-if="hasActiveFilters && !isPhone"
        color="neutral"
        variant="ghost"
        size="sm"
        icon="i-lucide-x"
        :label="t('events.filters.clear')"
        class="hidden sm:inline-flex"
        @click="clearFilters"
      />
    </div>
  </div>
</template>
