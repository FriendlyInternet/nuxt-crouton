<script setup lang="ts">
import { ref, computed, inject } from 'vue'
import type { GridSize } from '../types/table'
import { CROUTON_ITEM_ACTION_KEY } from '../types/table'

interface Props {
  item: any
  layout: 'list' | 'grid'
  collection: string
  /** Grid size variant (only used when layout='grid') */
  size?: GridSize
  /** When true, hides action buttons (stateless/preview mode) */
  stateless?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  size: 'comfortable',
  stateless: false
})

// Item action: use provided handler (inline-aware) or fall back to crouton.open()
const itemAction = inject(CROUTON_ITEM_ACTION_KEY, undefined)
const crouton = useCrouton()

// Action handlers
function handleEdit() {
  if (itemAction) {
    itemAction('update', [props.item.id])
  } else {
    crouton?.open('update', props.collection, [props.item.id])
  }
}

function handleDelete() {
  if (itemAction) {
    itemAction('delete', [props.item.id])
  } else {
    crouton?.open('delete', props.collection, [props.item.id])
  }
}

const isExpanded = ref(false)

// Display config from Phase 1
const display = useDisplayConfig(props.collection)
const hasDisplayConfig = computed(() => Object.keys(display).length > 0)

// Display values resolved from display config
const titleValue = computed(() => {
  if (display.title && props.item[display.title]) return String(props.item[display.title])
  // Fallback: try common fields
  const tryFields = ['name', 'title', 'label', 'slug', 'email', 'username']
  for (const field of tryFields) {
    if (props.item[field]) return String(props.item[field])
  }
  return null
})

const subtitleValue = computed(() => {
  if (!display.subtitle) return null
  return props.item[display.subtitle] ? String(props.item[display.subtitle]) : null
})

const imageValue = computed(() => {
  if (!display.image) return null
  return props.item[display.image] || null
})

const badgeValue = computed(() => {
  if (!display.badge) return null
  return props.item[display.badge] ? String(props.item[display.badge]) : null
})

const descriptionValue = computed(() => {
  if (!display.description) return null
  const value = props.item[display.description]
  if (!value) return null
  const str = String(value)
  return str.length > 120 ? str.slice(0, 120) + '...' : str
})

// Format JSON for display (fallback when no display config)
const formattedJson = computed(() => {
  try {
    return JSON.stringify(props.item, null, 2)
  } catch {
    return '{}'
  }
})

// Truncate ID for display
const displayId = computed(() => {
  const id = String(props.item.id || '')
  if (id.length > 12) {
    return `${id.slice(0, 6)}...${id.slice(-4)}`
  }
  return id
})

// UCard ui overrides based on size
const cardUi = computed(() => {
  switch (props.size) {
    case 'compact':
      return {
        root: 'hover:shadow-md transition-shadow',
        body: 'p-2'
      }
    case 'spacious':
      return {
        root: 'rounded-xl hover:shadow-lg transition-shadow',
        body: 'p-0'
      }
    case 'comfortable':
    default:
      return {
        root: 'hover:shadow-md transition-shadow',
        body: hasDisplayConfig.value ? 'p-0' : 'p-3'
      }
  }
})
</script>

<template>
  <!-- List Layout -->
  <div
    v-if="layout === 'list'"
    class="group flex items-center gap-3"
  >
    <!-- Thumbnail for list (when display config has image) -->
    <div
      v-if="imageValue"
      class="shrink-0 size-10 rounded overflow-hidden bg-gray-100 dark:bg-gray-800"
    >
      <img
        :src="imageValue"
        :alt="titleValue || ''"
        class="size-full object-cover"
      >
    </div>

    <div class="flex-1 min-w-0">
      <div class="flex items-center gap-2">
        <slot name="presence" />
        <CroutonCardHelpModal
          v-if="!hasDisplayConfig"
          :collection="collection"
          layout="list"
        />
        <span
          v-if="titleValue"
          class="font-medium text-default truncate"
        >
          {{ titleValue }}
        </span>
        <UBadge
          v-if="badgeValue"
          color="neutral"
          variant="subtle"
          size="xs"
        >
          {{ badgeValue }}
        </UBadge>
        <code
          v-if="!hasDisplayConfig"
          class="text-xs text-muted bg-muted/30 px-1.5 py-0.5 rounded font-mono"
        >
          {{ item.id }}
        </code>
      </div>
      <p
        v-if="subtitleValue"
        class="text-sm text-muted truncate mt-0.5"
      >
        {{ subtitleValue }}
      </p>
      <!-- Fallback: JSON viewer when no display config -->
      <UCollapsible
        v-if="!hasDisplayConfig"
        v-model:open="isExpanded"
      >
        <UButton
          color="neutral"
          variant="ghost"
          size="xs"
          class="mt-1 -ml-2"
          :trailing-icon="isExpanded ? 'i-lucide-chevron-up' : 'i-lucide-chevron-down'"
        >
          {{ isExpanded ? 'Hide' : 'Show' }} JSON
        </UButton>
        <template #content>
          <pre class="text-xs bg-muted/20 p-3 rounded mt-2 overflow-auto max-h-64 font-mono">{{ formattedJson }}</pre>
        </template>
      </UCollapsible>
    </div>

    <CroutonItemButtonsMini
      v-if="!stateless"
      delete
      update
      class="opacity-0 group-hover:opacity-100 pointer-coarse:opacity-100 transition-opacity shrink-0"
      @delete="handleDelete"
      @update="handleEdit"
    />
  </div>

  <!-- Grid Layout (display-aware) -->
  <UCard
    v-else-if="layout === 'grid' && hasDisplayConfig"
    variant="outline"
    :ui="cardUi"
  >
    <div class="group">
      <!-- Hero image -->
      <div
        v-if="imageValue"
        class="aspect-video w-full overflow-hidden bg-gray-100 dark:bg-gray-800"
        :class="size === 'spacious' ? 'rounded-t-xl' : 'rounded-t-lg'"
      >
        <img
          :src="imageValue"
          :alt="titleValue || ''"
          class="size-full object-cover"
        >
      </div>

      <div
        :class="size === 'compact' ? 'p-2' : size === 'spacious' ? 'p-4' : 'p-3'"
      >
        <div class="flex items-start justify-between gap-2">
          <div class="min-w-0 flex-1">
            <h3
              v-if="titleValue"
              :class="size === 'compact' ? 'text-xs font-medium' : size === 'spacious' ? 'text-base font-semibold' : 'text-sm font-medium'"
              class="text-default truncate"
            >
              {{ titleValue }}
            </h3>
            <p
              v-if="subtitleValue"
              :class="size === 'compact' ? 'text-[10px]' : 'text-xs'"
              class="text-muted truncate mt-0.5"
            >
              {{ subtitleValue }}
            </p>
          </div>
          <div class="flex items-center gap-1.5 shrink-0">
            <UBadge
              v-if="badgeValue"
              color="neutral"
              variant="subtle"
              :size="size === 'compact' ? 'xs' : 'sm'"
            >
              {{ badgeValue }}
            </UBadge>
            <CroutonItemButtonsMini
              v-if="!stateless"
              delete
              update
              class="opacity-0 group-hover:opacity-100 pointer-coarse:opacity-100 transition-opacity"
              @delete="handleDelete"
              @update="handleEdit"
            />
          </div>
        </div>
        <p
          v-if="descriptionValue && size !== 'compact'"
          class="text-xs text-muted mt-2 line-clamp-2"
        >
          {{ descriptionValue }}
        </p>
      </div>
    </div>
  </UCard>

  <!-- Grid Layout fallback (no display config — original behavior) -->
  <UCard
    v-else-if="layout === 'grid'"
    variant="outline"
    :ui="{ root: 'hover:shadow-md transition-shadow', body: 'p-3' }"
  >
    <div class="flex flex-col gap-2 group">
      <div class="flex items-center justify-between">
        <div class="flex items-center gap-1.5 min-w-0">
          <slot name="presence" />
          <CroutonCardHelpModal :collection="collection" layout="grid" />
          <code class="text-xs text-muted bg-muted/30 px-1.5 py-0.5 rounded font-mono shrink-0 truncate">
            {{ displayId }}
          </code>
          <span
            v-if="titleValue"
            class="font-medium text-default text-sm truncate flex-1"
          >
            {{ titleValue }}
          </span>
        </div>
        <CroutonItemButtonsMini
          v-if="!stateless"
          delete
          update
          class="opacity-0 group-hover:opacity-100 pointer-coarse:opacity-100 transition-opacity shrink-0"
          @delete="handleDelete"
          @update="handleEdit"
        />
      </div>
      <UCollapsible v-model:open="isExpanded">
        <UButton
          color="neutral"
          variant="ghost"
          size="xs"
          class="-ml-2"
          :trailing-icon="isExpanded ? 'i-lucide-chevron-up' : 'i-lucide-chevron-down'"
        >
          JSON
        </UButton>
        <template #content>
          <pre class="text-[11px] bg-muted/20 p-2 rounded mt-1 overflow-auto max-h-32 font-mono">{{ formattedJson }}</pre>
        </template>
      </UCollapsible>
    </div>
  </UCard>
</template>
