<template>
  <div class="space-y-6">
    <!-- Header -->
    <div class="flex items-center justify-between">
      <div>
        <h2 class="text-lg font-semibold text-gray-900 dark:text-white">
          {{ t('admin.translations.title') }}
        </h2>
        <p class="text-sm text-gray-500 dark:text-gray-400">
          {{ t('admin.translations.subtitle') }}
        </p>
      </div>
      <UButton
        icon="i-lucide-plus"
        color="primary"
        @click="openNewModal"
      >
        {{ t('admin.translations.addTranslation') }}
      </UButton>
    </div>

    <!-- Search/Filter -->
    <div class="flex gap-4">
      <UInput
        v-model="search"
        :placeholder="t('admin.translations.searchPlaceholder')"
        icon="i-lucide-search"
        class="w-64"
      />
      <USelect
        v-model="categoryFilter"
        :items="categories"
        :placeholder="t('admin.translations.allCategories')"
        class="w-48"
      />
    </div>

    <!-- Loading state -->
    <div
      v-if="pending"
      class="flex justify-center py-8"
    >
      <UIcon
        name="i-lucide-loader-circle"
        class="w-6 h-6 animate-spin text-gray-400"
      />
    </div>

    <!-- Error state -->
    <UAlert
      v-else-if="error"
      color="error"
      icon="i-lucide-alert-circle"
      :title="t('admin.translations.loadFailed')"
      :description="error?.message"
    />

    <!-- Translations table -->
    <UTable
      v-else
      :data="paginatedItems"
      :columns="columns"
    >
      <template #empty>
        <div class="flex flex-col items-center gap-2 py-6 text-gray-500 dark:text-gray-400">
          <UIcon name="i-lucide-languages" class="w-8 h-8" />
          <span class="text-sm">{{ t('admin.translations.noTranslationsFound') }}</span>
        </div>
      </template>
      <!-- Key Path -->
      <template #keyPath-cell="{ row }">
        <code class="text-xs bg-gray-100 dark:bg-gray-800 px-1.5 py-0.5 rounded">
          {{ row.original.keyPath }}
        </code>
      </template>

      <!-- Category -->
      <template #category-cell="{ row }">
        <UBadge
          color="neutral"
          variant="subtle"
          size="sm"
        >
          {{ row.original.category }}
        </UBadge>
      </template>

      <!-- System Values -->
      <template #systemValues-cell="{ row }">
        <span class="text-sm text-gray-700 dark:text-gray-300 line-clamp-2">
          {{ row.original.systemValues?.en || '—' }}
        </span>
      </template>

      <!-- Team Override -->
      <template #teamValues-cell="{ row }">
        <template v-if="row.original.hasOverride">
          <span class="text-sm text-primary line-clamp-2">
            {{ row.original.teamValues?.en || '—' }}
          </span>
        </template>
        <span
          v-else
          class="text-gray-400 text-sm italic"
        >—</span>
      </template>

      <!-- Status -->
      <template #status-cell="{ row }">
        <UBadge
          :color="row.original.hasOverride ? 'success' : 'info'"
          variant="subtle"
          size="sm"
        >
          {{ row.original.hasOverride ? t('admin.translations.overridden') : t('admin.translations.system') }}
        </UBadge>
      </template>

      <!-- Actions -->
      <template #actions-cell="{ row }">
        <div class="flex gap-1">
          <UButton
            icon="i-lucide-pencil"
            size="xs"
            color="neutral"
            variant="ghost"
            @click="openOverrideModal(row.original)"
          />
          <UButton
            v-if="row.original.hasOverride"
            icon="i-lucide-trash-2"
            size="xs"
            color="error"
            variant="ghost"
            @click="deleteOverride(row.original)"
          />
        </div>
      </template>
    </UTable>

    <!-- Pagination -->
    <div
      v-if="!pending && !error && filteredItems.length > pageSize"
      class="flex items-center justify-between pt-2"
    >
      <span class="text-sm text-gray-500">
        {{ t('admin.translations.paginationSummary', { from: (currentPage - 1) * pageSize + 1, to: Math.min(currentPage * pageSize, filteredItems.length), total: filteredItems.length }) }}
      </span>
      <UPagination
        v-model="currentPage"
        :items-per-page="pageSize"
        :total="filteredItems.length"
      />
    </div>

    <!-- Override Modal -->
    <UModal v-model:open="showModal">
      <template #content>
        <div class="p-6 space-y-4">
          <h3 class="text-lg font-semibold text-gray-900 dark:text-white">
            {{ isNewMode ? t('admin.translations.newTranslation') : t('admin.translations.editOverride') }}
          </h3>

          <!-- Key Path: searchable select for new, read-only for override -->
          <UFormField :label="t('admin.translations.keyPath')">
            <UInputMenu
              v-if="isNewMode"
              v-model="newKeyPath"
              :items="availableKeyItems"
              value-key="value"
              :placeholder="t('admin.translations.searchKeysPlaceholder')"
              icon="i-lucide-search"
              class="w-full"
            />
            <code
              v-else
              class="block text-sm bg-gray-100 dark:bg-gray-800 px-2 py-1 rounded"
            >
              {{ editingItem?.keyPath }}
            </code>
          </UFormField>

          <!-- Show current system value when a key is selected in new mode -->
          <div
            v-if="isNewMode && newKeyPath && selectedKeySystemValues"
            class="space-y-2 bg-gray-50 dark:bg-gray-800/50 rounded-lg p-3"
          >
            <label class="text-xs font-medium text-gray-500">{{ t('admin.translations.currentValue') }}</label>
            <div
              v-for="locale in locales"
              :key="locale"
              class="flex gap-2"
            >
              <span class="w-8 text-xs font-medium text-gray-500 uppercase shrink-0 pt-0.5">{{ locale }}</span>
              <span class="text-sm text-gray-700 dark:text-gray-300">
                {{ selectedKeySystemValues[locale] || '—' }}
              </span>
            </div>
          </div>

          <!-- System values: only show for override mode -->
          <template v-if="!isNewMode">
            <div class="space-y-2">
              <label class="text-sm font-medium text-gray-700 dark:text-gray-300">{{ t('admin.translations.systemValues') }}</label>
              <div
                v-if="editingItem"
                class="space-y-2 bg-gray-50 dark:bg-gray-800/50 rounded-lg p-3"
              >
                <div
                  v-for="locale in locales"
                  :key="locale"
                  class="flex gap-2"
                >
                  <span class="w-8 text-xs font-medium text-gray-500 uppercase shrink-0 pt-0.5">{{ locale }}</span>
                  <span class="text-sm text-gray-700 dark:text-gray-300">
                    {{ editingItem.systemValues?.[locale] || '—' }}
                  </span>
                </div>
              </div>
            </div>

            <USeparator />
          </template>

          <UFormField :label="isNewMode ? t('admin.translations.values') : t('admin.translations.teamOverrideValues')">
            <div class="w-full space-y-2">
              <div
                v-for="locale in locales"
                :key="locale"
                class="flex items-center gap-2"
              >
                <span class="w-8 text-xs font-medium text-gray-500 uppercase shrink-0">{{ locale }}</span>
                <UInput
                  v-model="overrideValues[locale]"
                  :placeholder="editingItem?.systemValues?.[locale] || ''"
                  class="flex-1"
                />
              </div>
            </div>
          </UFormField>

          <div class="flex justify-end gap-2 pt-4">
            <UButton
              color="neutral"
              variant="ghost"
              @click="showModal = false"
            >
              {{ t('common.cancel') }}
            </UButton>
            <UButton
              color="primary"
              @click="isNewMode ? createNew() : saveOverride()"
            >
              {{ isNewMode ? t('common.create') : (editingItem?.hasOverride ? t('admin.translations.updateOverride') : t('admin.translations.createOverride')) }}
            </UButton>
          </div>
        </div>
      </template>
    </UModal>
  </div>
</template>

<script setup lang="ts">
const { t } = useT()

interface TranslationWithOverride {
  keyPath: string
  category: string
  namespace: string
  systemValues: Record<string, string>
  systemId: string
  isOverrideable: boolean
  teamValues: Record<string, string> | null
  hasOverride: boolean
  overrideId: string | null
  overrideDescription: string | null
  overrideUpdatedAt: Date | null
}

const { teamSlug } = useTeamContext()
const notify = useNotify()

// Fetch team overrides from DB
const { data: dbItems, pending, error, refresh } = await useFetch<TranslationWithOverride[]>(
  () => `/api/teams/${teamSlug.value}/translations-ui/with-system`,
  { watch: [teamSlug] }
)

// Merge locale file keys with DB overrides for a complete view
const items = computed(() => {
  const dbMap = new Map((dbItems.value || []).map(i => [i.keyPath, i]))
  const result: TranslationWithOverride[] = []

  for (const { key } of flatKeys.value) {
    const dbItem = dbMap.get(key)
    if (dbItem) {
      result.push(dbItem)
      dbMap.delete(key)
    } else {
      // Build from locale files
      const systemValues: Record<string, string> = {}
      for (const locale of locales.value) {
        const messages = toRaw(getLocaleMessage(locale)) as Record<string, any>
        let current: any = messages
        for (const part of key.split('.')) current = current?.[part]
        // Handle vue-i18n compiled messages
        if (current && typeof current === 'object' && current.loc?.source) {
          systemValues[locale] = current.loc.source
        } else if (typeof current === 'string') {
          systemValues[locale] = current
        }
      }
      result.push({
        keyPath: key,
        category: key.split('.')[0] || 'custom',
        namespace: 'ui',
        systemValues,
        systemId: '',
        isOverrideable: true,
        teamValues: null,
        hasOverride: false,
        overrideId: null,
        overrideDescription: null,
        overrideUpdatedAt: null
      })
    }
  }
  // Include any DB-only items not in locale files
  for (const item of dbMap.values()) result.push(item)
  return result
})

// Table columns
const columns = computed(() => [
  { accessorKey: 'keyPath', header: t('admin.translations.columnKey') },
  { accessorKey: 'category', header: t('admin.translations.columnCategory') },
  { accessorKey: 'systemValues', header: t('admin.translations.columnValueEn') },
  { accessorKey: 'teamValues', header: t('admin.translations.columnOverride') },
  { accessorKey: 'status', header: t('admin.translations.columnStatus') },
  { accessorKey: 'actions', header: '' }
])

// Locales for override form (derived from i18n config)
const { locales: i18nLocales, getLocaleMessage } = useI18n()
const locales = computed(() =>
  i18nLocales.value.map((l: any) => typeof l === 'string' ? l : l.code)
)

// Build flattened key list from i18n locale messages
// Handles vue-i18n compiled messages where each key is stored as:
// { loc: { source: "value" }, body: { static: "value" } }
function flattenMessages(obj: Record<string, any>, prefix = '', depth = 0, seen = new WeakSet()): { key: string, value: string }[] {
  if (depth > 10 || typeof obj !== 'object' || obj === null || Array.isArray(obj)) return []
  const raw = toRaw(obj)
  if (seen.has(raw)) return []
  seen.add(raw)

  const result: { key: string, value: string }[] = []
  for (const [k, v] of Object.entries(raw)) {
    const path = prefix ? `${prefix}.${k}` : k
    if (typeof v === 'string') {
      result.push({ key: path, value: v })
    } else if (typeof v === 'object' && v !== null && !Array.isArray(v)) {
      const rawV = toRaw(v)
      // Detect vue-i18n compiled message: { loc: { source: "..." }, body: { ... } }
      if (rawV.loc?.source && typeof rawV.loc.source === 'string') {
        result.push({ key: path, value: rawV.loc.source })
      } else {
        result.push(...flattenMessages(rawV, path, depth + 1, seen))
      }
    }
  }
  return result
}

const flatKeys = computed(() => {
  const messages = toRaw(getLocaleMessage('en')) as Record<string, any>
  return flattenMessages(messages)
})

const availableKeyItems = computed(() =>
  flatKeys.value.map(({ key, value }) => ({
    label: `${key} — ${value.length > 40 ? value.slice(0, 40) + '…' : value}`,
    value: key
  }))
)

// Get system values for selected key across all locales
const selectedKeySystemValues = computed(() => {
  if (!newKeyPath.value) return null
  const values: Record<string, string> = {}
  for (const locale of locales.value) {
    const messages = toRaw(getLocaleMessage(locale)) as Record<string, any>
    const parts = newKeyPath.value.split('.')
    let current: any = messages
    for (const part of parts) {
      current = current?.[part]
    }
    // Handle vue-i18n compiled messages
    if (current && typeof current === 'object' && current.loc?.source) {
      values[locale] = current.loc.source
    } else if (typeof current === 'string') {
      values[locale] = current
    }
  }
  return Object.keys(values).length > 0 ? values : null
})

// Search, filter, pagination
const search = ref('')
const categoryFilter = ref<string | undefined>(undefined)
const currentPage = ref(1)
const pageSize = 50

const categories = computed(() => {
  if (!items.value) return []
  const cats = [...new Set(items.value.map(i => i.category))]
  return [{ label: t('admin.translations.allCategories'), value: undefined }, ...cats.map(c => ({ label: c, value: c }))]
})

const filteredItems = computed(() => {
  if (!items.value) return []
  return items.value.filter((item) => {
    const matchesSearch = !search.value
      || item.keyPath.toLowerCase().includes(search.value.toLowerCase())
    const matchesCategory = !categoryFilter.value || item.category === categoryFilter.value
    return matchesSearch && matchesCategory
  })
})

// Reset page when filters change
watch([search, categoryFilter], () => { currentPage.value = 1 })

const paginatedItems = computed(() => {
  const start = (currentPage.value - 1) * pageSize
  return filteredItems.value.slice(start, start + pageSize)
})

// Modal state
const showModal = ref(false)
const isNewMode = ref(false)
const editingItem = ref<TranslationWithOverride | null>(null)
const overrideValues = ref<Record<string, string>>({})
const newKeyPath = ref('')

function openNewModal() {
  isNewMode.value = true
  editingItem.value = null
  newKeyPath.value = ''
  overrideValues.value = {}
  showModal.value = true
}

function openOverrideModal(item: TranslationWithOverride) {
  isNewMode.value = false
  editingItem.value = item
  // Pre-fill with existing team values or empty
  overrideValues.value = { ...(item.teamValues ?? {}) }
  showModal.value = true
}

async function saveOverride() {
  if (!editingItem.value) return

  // Filter out empty values
  const values = Object.fromEntries(
    Object.entries(overrideValues.value).filter(([, v]) => v && v.trim())
  )

  if (Object.keys(values).length === 0) {
    notify.warning(t('admin.translations.valueRequired'))
    return
  }

  try {
    if (editingItem.value.hasOverride && editingItem.value.overrideId) {
      // Update existing override
      await $fetch(`/api/teams/${teamSlug.value}/translations-ui/${editingItem.value.overrideId}`, {
        method: 'PATCH',
        body: { values }
      })
      notify.success(t('admin.translations.overrideUpdated'))
    } else {
      // Create new override
      await $fetch(`/api/teams/${teamSlug.value}/translations-ui`, {
        method: 'POST',
        body: {
          keyPath: editingItem.value.keyPath,
          category: editingItem.value.category,
          namespace: editingItem.value.namespace,
          values
        }
      })
      notify.success(t('admin.translations.overrideCreated'))
    }

    showModal.value = false
    await refresh()
  } catch (err: unknown) {
    const errorMessage = err instanceof Error ? err.message : t('admin.translations.saveOverrideFailed')
    notify.error(errorMessage)
  }
}

async function createNew() {
  const keyPath = newKeyPath.value.trim()
  const category = keyPath.split('.')[0] || 'custom'

  if (!keyPath) {
    notify.warning(t('admin.translations.keyPathRequired'))
    return
  }

  const values = Object.fromEntries(
    Object.entries(overrideValues.value).filter(([, v]) => v && v.trim())
  )

  if (Object.keys(values).length === 0) {
    notify.warning(t('admin.translations.valueRequired'))
    return
  }

  try {
    await $fetch(`/api/teams/${teamSlug.value}/translations-ui`, {
      method: 'POST',
      body: { keyPath, category, values }
    })
    notify.success(t('admin.translations.translationCreated'))
    showModal.value = false
    await refresh()
  } catch (err: unknown) {
    const errorMessage = err instanceof Error ? err.message : t('admin.translations.createFailed')
    notify.error(errorMessage)
  }
}

async function deleteOverride(item: TranslationWithOverride) {
  if (!item.overrideId) return

  try {
    await $fetch(`/api/teams/${teamSlug.value}/translations-ui/${item.overrideId}`, {
      method: 'DELETE'
    })
    notify.success(t('admin.translations.overrideRemoved'))
    await refresh()
  } catch (err: unknown) {
    const errorMessage = err instanceof Error ? err.message : t('admin.translations.deleteOverrideFailed')
    notify.error(errorMessage)
  }
}
</script>
