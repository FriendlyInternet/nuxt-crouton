<script setup lang="ts">
/**
 * Icon Picker
 *
 * Searchable icon picker using the Iconify public API.
 * Supports collection filtering and manual input fallback.
 */
import { useDebounceFn } from '@vueuse/core'

const { t } = useT()

interface Props {
  modelValue?: string
  size?: 'sm' | 'md'
  placeholder?: string
  collections?: string[]
}

const props = withDefaults(defineProps<Props>(), {
  modelValue: '',
  size: 'sm',
  placeholder: 'Select icon',
  collections: () => ['lucide', 'simple-icons']
})

const emit = defineEmits<{
  'update:modelValue': [value: string]
}>()

const open = ref(false)
const searchQuery = ref('')
const activeCollection = ref(props.collections[0] || 'lucide')
const icons = ref<string[]>([])
const loading = ref(false)
const manualInput = ref('')

// Collection display names
const collectionLabels: Record<string, string> = {
  'lucide': 'Lucide',
  'simple-icons': 'Simple Icons',
  'heroicons': 'Heroicons',
  'mdi': 'Material Design',
  'ph': 'Phosphor'
}

// Convert Iconify format to i- format: "lucide:star" → "i-lucide-star"
function toIconClass(iconName: string): string {
  return `i-${iconName.replace(':', '-')}`
}

// Search icons via Iconify API
async function searchIcons(query: string, prefix: string) {
  loading.value = true
  try {
    const params = new URLSearchParams({
      query: query || 'a',
      prefix,
      limit: '64'
    })
    const data = await $fetch<{ icons: string[] }>(`https://api.iconify.design/search?${params}`)
    icons.value = data.icons || []
  }
  catch {
    icons.value = []
  }
  finally {
    loading.value = false
  }
}

// Load popular/default icons for a collection (browse mode)
async function loadCollectionIcons(prefix: string) {
  loading.value = true
  try {
    const data = await $fetch<{ uncategorized?: string[], categories?: Record<string, string[]> }>(
      `https://api.iconify.design/collection?prefix=${prefix}`
    )
    // Flatten categories or use uncategorized, take first 64
    const allIcons: string[] = []
    if (data.categories) {
      for (const categoryIcons of Object.values(data.categories)) {
        allIcons.push(...categoryIcons)
        if (allIcons.length >= 64) break
      }
    }
    else if (data.uncategorized) {
      allIcons.push(...data.uncategorized)
    }
    icons.value = allIcons.slice(0, 64).map(name => `${prefix}:${name}`)
  }
  catch {
    icons.value = []
  }
  finally {
    loading.value = false
  }
}

const debouncedSearch = useDebounceFn((query: string) => {
  if (query.trim()) {
    searchIcons(query, activeCollection.value)
  }
  else {
    loadCollectionIcons(activeCollection.value)
  }
}, 300)

// Watch search query changes
watch(searchQuery, (val) => {
  debouncedSearch(val)
})

// Switch collection
function switchCollection(prefix: string) {
  activeCollection.value = prefix
  if (searchQuery.value.trim()) {
    searchIcons(searchQuery.value, prefix)
  }
  else {
    loadCollectionIcons(prefix)
  }
}

// Select an icon
function selectIcon(iconName: string) {
  const iconClass = toIconClass(iconName)
  emit('update:modelValue', iconClass)
  open.value = false
}

// Apply manual input
function applyManualInput() {
  const val = manualInput.value.trim()
  if (val) {
    emit('update:modelValue', val)
    open.value = false
  }
}

// Clear selection
function clearIcon() {
  emit('update:modelValue', '')
}

// Load icons when popover opens
watch(open, (isOpen) => {
  if (isOpen) {
    manualInput.value = props.modelValue || ''
    searchQuery.value = ''
    loadCollectionIcons(activeCollection.value)
  }
})
</script>

<template>
  <UPopover v-model:open="open" :ui="{ content: 'p-0' }">
    <!-- Trigger button -->
    <UButton
      :size="size"
      color="neutral"
      variant="outline"
      class="justify-start"
      block
    >
      <template #leading>
        <UIcon
          v-if="modelValue"
          :name="modelValue"
          class="size-4"
        />
        <UIcon
          v-else
          name="i-lucide-smile-plus"
          class="size-4 text-muted"
        />
      </template>
      <span :class="modelValue ? '' : 'text-muted'">
        {{ modelValue || placeholder }}
      </span>
      <template #trailing>
        <UButton
          v-if="modelValue"
          color="neutral"
          variant="ghost"
          icon="i-lucide-x"
          size="xs"
          class="-mr-1.5"
          @click.stop="clearIcon"
        />
      </template>
    </UButton>

    <!-- Popover content -->
    <template #content>
      <div class="w-80 p-3 space-y-3">
        <!-- Search input -->
        <UInput
          v-model="searchQuery"
          icon="i-lucide-search"
          :placeholder="`Search ${collectionLabels[activeCollection] || activeCollection} icons...`"
          size="sm"
          autofocus
        />

        <!-- Collection filter chips -->
        <div v-if="collections.length > 1" class="flex gap-1">
          <UButton
            v-for="col in collections"
            :key="col"
            :color="activeCollection === col ? 'primary' : 'neutral'"
            :variant="activeCollection === col ? 'soft' : 'ghost'"
            size="xs"
            @click="switchCollection(col)"
          >
            {{ collectionLabels[col] || col }}
          </UButton>
        </div>

        <!-- Icon grid -->
        <div class="relative min-h-[160px]">
          <!-- Loading -->
          <div v-if="loading" class="absolute inset-0 flex items-center justify-center">
            <UIcon name="i-lucide-loader-2" class="size-5 text-muted animate-spin" />
          </div>

          <!-- Results -->
          <div
            v-else-if="icons.length"
            class="grid grid-cols-8 gap-1 max-h-[200px] overflow-y-auto"
          >
            <!-- UButton cells (not raw buttons) so themes reach them (#1410) -->
            <UButton
              v-for="icon in icons"
              :key="icon"
              color="neutral"
              variant="ghost"
              size="sm"
              square
              :icon="toIconClass(icon)"
              class="justify-center size-8 p-0"
              :class="{ 'bg-primary/10 ring-1 ring-primary': toIconClass(icon) === modelValue }"
              :title="icon"
              @click="selectIcon(icon)"
            />
          </div>

          <!-- Empty state -->
          <div v-else class="flex flex-col items-center justify-center h-[160px] text-muted">
            <UIcon name="i-lucide-search-x" class="size-6 mb-1" />
            <span class="text-xs">{{ t('iconPicker.noIcons') }}</span>
          </div>
        </div>

        <!-- Manual input fallback -->
        <div class="border-t border-default pt-2">
          <div class="flex gap-1">
            <UInput
              v-model="manualInput"
              placeholder="i-lucide-star"
              size="xs"
              class="flex-1 font-mono"
              @keydown.enter="applyManualInput"
            >
              <template #leading>
                <UIcon
                  v-if="manualInput"
                  :name="manualInput"
                  class="size-3"
                />
              </template>
            </UInput>
            <UButton
              color="primary"
              size="xs"
              :disabled="!manualInput.trim()"
              @click="applyManualInput"
            >
              {{ t('common.apply') }}
            </UButton>
          </div>
        </div>
      </div>
    </template>
  </UPopover>
</template>
