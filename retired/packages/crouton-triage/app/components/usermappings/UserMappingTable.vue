<script setup lang="ts">
/**
 * UserMappingTable - Display existing user mappings
 *
 * Shows a table of user mappings with actions to edit or delete.
 * Supports filtering by sourceType and sourceWorkspaceId.
 */

interface UserMapping {
  id: string
  sourceType: string
  sourceWorkspaceId: string
  sourceUserId: string
  sourceUserEmail?: string | null
  sourceUserName?: string | null
  notionUserId: string | null
  notionUserName?: string | null
  notionUserEmail?: string | null
  mappingType: string
  confidence: number
  active: boolean
}

interface Props {
  /** User mappings to display */
  mappings: UserMapping[]
  /** Loading state */
  loading?: boolean
  /** Show edit actions */
  editable?: boolean
  /** Compact mode for sidebars */
  compact?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  loading: false,
  editable: true,
  compact: false
})

const emit = defineEmits<{
  edit: [mapping: UserMapping]
  delete: [mapping: UserMapping]
}>()

// Source type icons
const sourceTypeIcon = (type: string) => {
  switch (type) {
    case 'slack': return 'i-lucide-slack'
    case 'figma': return 'i-lucide-figma'
    default: return 'i-lucide-user'
  }
}

// Mapping type badges
const mappingTypeBadge = (type: string) => {
  switch (type) {
    case 'auto-email': return { color: 'success' as const, label: 'Auto (Email)' }
    case 'discovered': return { color: 'warning' as const, label: 'Discovered' }
    case 'manual': return { color: 'neutral' as const, label: 'Manual' }
    default: return { color: 'neutral' as const, label: type }
  }
}

// Confidence display
const confidenceDisplay = (confidence: number) => {
  if (confidence >= 0.9) return { color: 'success' as const, label: 'High' }
  if (confidence >= 0.5) return { color: 'warning' as const, label: 'Medium' }
  return { color: 'error' as const, label: 'Low' }
}
</script>

<template>
  <div class="user-mapping-table">
    <!-- Loading state -->
    <div v-if="loading" class="flex items-center justify-center py-8 text-muted">
      <UIcon name="i-lucide-loader-2" class="w-5 h-5 animate-spin mr-2" />
      Loading mappings...
    </div>

    <!-- Empty state -->
    <div v-else-if="mappings.length === 0" class="text-center py-8 text-muted">
      <UIcon name="i-lucide-users" class="w-12 h-12 mx-auto mb-3 opacity-30" />
      <p>No user mappings yet</p>
      <p class="text-sm mt-1">Map source users to Notion users to enable @mention resolution</p>
    </div>

    <!-- Mappings list -->
    <div v-else class="space-y-2">
      <div
        v-for="mapping in mappings"
        :key="mapping.id"
        class="flex items-center gap-3 p-3 rounded-lg border border-gray-200 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-900 transition-colors"
        :class="{ 'opacity-50': !mapping.active }"
      >
        <!-- Source info -->
        <div class="flex items-center gap-2 flex-1 min-w-0">
          <UIcon
            :name="sourceTypeIcon(mapping.sourceType)"
            class="w-5 h-5 flex-shrink-0"
          />
          <div class="min-w-0">
            <p class="font-medium truncate">
              {{ mapping.sourceUserName || mapping.sourceUserEmail || mapping.sourceUserId }}
            </p>
            <p v-if="mapping.sourceUserEmail && mapping.sourceUserName" class="text-xs text-muted truncate">
              {{ mapping.sourceUserEmail }}
            </p>
          </div>
        </div>

        <!-- Arrow -->
        <UIcon name="i-lucide-arrow-right" class="w-4 h-4 text-muted flex-shrink-0" />

        <!-- Notion info -->
        <div class="flex items-center gap-2 flex-1 min-w-0">
          <UIcon name="i-simple-icons-notion" class="w-5 h-5 flex-shrink-0" />
          <div class="min-w-0">
            <template v-if="mapping.notionUserId">
              <p class="font-medium truncate">
                {{ mapping.notionUserName || mapping.notionUserId }}
              </p>
              <p v-if="mapping.notionUserEmail" class="text-xs text-muted truncate">
                {{ mapping.notionUserEmail }}
              </p>
            </template>
            <template v-else>
              <p class="text-muted italic">Not mapped</p>
            </template>
          </div>
        </div>

        <!-- Status badges -->
        <div v-if="!compact" class="flex items-center gap-2 flex-shrink-0">
          <UBadge
            :color="mappingTypeBadge(mapping.mappingType).color"
            variant="soft"
            size="xs"
          >
            {{ mappingTypeBadge(mapping.mappingType).label }}
          </UBadge>
          <UBadge
            v-if="mapping.confidence > 0"
            :color="confidenceDisplay(mapping.confidence).color"
            variant="outline"
            size="xs"
          >
            {{ Math.round(mapping.confidence * 100) }}%
          </UBadge>
        </div>

        <!-- Actions -->
        <div v-if="editable" class="flex items-center gap-1 flex-shrink-0">
          <UButton
            color="neutral"
            variant="ghost"
            size="xs"
            icon="i-lucide-pencil"
            @click="emit('edit', mapping)"
          />
          <UButton
            color="error"
            variant="ghost"
            size="xs"
            icon="i-lucide-trash"
            @click="emit('delete', mapping)"
          />
        </div>
      </div>
    </div>
  </div>
</template>
