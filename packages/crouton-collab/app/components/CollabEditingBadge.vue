<script setup lang="ts">
import { computed, toRef } from 'vue'
import type { CollabAwarenessState } from '../types/collab'
import { useCollabRoomUsers } from '../composables/useCollabRoomUsers'

/**
 * CollabEditingBadge - Shows "X editing" indicator for collection list items
 *
 * Used for Phase 6 global presence - displays a badge showing how many
 * users are currently editing an item, with user avatars on hover.
 *
 * @example
 * ```vue
 * <!-- Basic usage with room ID -->
 * <CollabEditingBadge
 *   room-id="page-123"
 *   room-type="page"
 * />
 *
 * <!-- With current user exclusion -->
 * <CollabEditingBadge
 *   room-id="page-123"
 *   room-type="page"
 *   :current-user-id="currentUser?.id"
 * />
 *
 * <!-- Custom poll interval -->
 * <CollabEditingBadge
 *   room-id="page-123"
 *   :poll-interval="10000"
 * />
 * ```
 */
interface Props {
  /** Room ID to check for users */
  roomId: string

  /** Room type (e.g., 'page', 'flow', 'document') */
  roomType?: string

  /** Current user ID to exclude from count */
  currentUserId?: string

  /** Polling interval in ms (default: 5000) */
  pollInterval?: number

  /** Size variant */
  size?: 'xs' | 'sm' | 'md'

  /** Whether to show user avatars on hover */
  showAvatars?: boolean

  /** Max avatars to show in tooltip */
  maxAvatars?: number

  /** Display variant: 'badge' shows green pill with text, 'avatars' shows only stacked circles */
  variant?: 'badge' | 'avatars'

  /** Show self in the count (for testing) - normally only shows other users */
  showSelf?: boolean

  /** Fixed users to show instead of polling the room (previews, tests) */
  users?: CollabAwarenessState[]
}

const props = withDefaults(defineProps<Props>(), {
  roomType: 'page',
  currentUserId: undefined,
  pollInterval: 5000,
  size: 'xs',
  showAvatars: true,
  maxAvatars: 5,
  variant: 'badge',
  showSelf: false,
  users: undefined
})

// Use the composable with reactive roomId
const { otherUsers, loading, users: polledUsers } = useCollabRoomUsers({
  roomId: toRef(() => props.roomId),
  roomType: props.roomType,
  currentUserId: toRef(() => props.currentUserId),
  pollInterval: props.pollInterval,
  excludeSelf: !!props.currentUserId,
  immediate: !props.users
})

// Display users/count - use all users when showSelf is true, otherwise just others
const displayUsers = computed(() => props.users ?? (props.showSelf ? polledUsers.value : otherUsers.value))
const displayCount = computed(() => displayUsers.value.length)

// Badge text
const badgeText = computed(() => {
  const count = displayCount.value
  if (count === 0) return ''
  if (count === 1) return '1 editing'
  return `${count} editing`
})

// Pill sizing only; avatars come from CollabPresence
const sizeClasses = computed(() => {
  switch (props.size) {
    case 'sm': return { badge: 'text-xs px-2 py-0.5' }
    case 'md': return { badge: 'text-sm px-2 py-1' }
    default: return { badge: 'text-[10px] px-1.5 py-0.5' }
  }
})

// Visible users for tooltip
const visibleUsers = computed(() => {
  return displayUsers.value.slice(0, props.maxAvatars)
})

// Overflow count
const overflowCount = computed(() => {
  const overflow = displayUsers.value.length - props.maxAvatars
  return overflow > 0 ? overflow : 0
})


// Tooltip content showing user list
const tooltipContent = computed(() => {
  if (displayUsers.value.length === 0) return ''

  const names = displayUsers.value.map(u => u.user?.name || 'Unknown')
  if (names.length === 1) return names[0]
  if (names.length === 2) return names.join(' and ')
  if (names.length <= 4) {
    return names.slice(0, -1).join(', ') + ' and ' + names[names.length - 1]
  }
  return names.slice(0, 3).join(', ') + ` and ${names.length - 3} others`
})

// Tooltip for avatars variant: "X editing: names"
const avatarsTooltip = computed(() => {
  if (displayUsers.value.length === 0) return ''

  const count = displayCount.value
  const names = displayUsers.value.map(u => u.user?.name || 'Unknown')

  if (count === 1) {
    return `1 editing: ${names[0]}`
  }
  if (names.length <= 3) {
    return `${count} editing: ${names.join(', ')}`
  }
  return `${count} editing: ${names.slice(0, 3).join(', ')} and ${names.length - 3} more`
})
</script>

<template>
  <div
    v-if="displayCount > 0 && !loading"
    class="collab-editing-badge inline-flex items-center"
  >
    <!-- AVATARS VARIANT: Just stacked circles with simple tooltip -->
    <UTooltip
      v-if="variant === 'avatars'"
      :delay-duration="200"
      :text="avatarsTooltip"
    >
      <CollabPresence
        :users="displayUsers"
        :max-visible="3"
        :size="size"
        :show-tooltip="false"
      />
    </UTooltip>

    <!-- BADGE VARIANT: Green pill with text + avatars (default) -->
    <UTooltip
      v-else-if="showAvatars"
      :delay-duration="200"
    >
      <template #default>
        <div
          class="inline-flex items-center gap-1 rounded-full bg-primary-50 dark:bg-primary-900/30 text-primary-600 dark:text-primary-400 font-medium"
          :class="sizeClasses.badge"
        >
          <CollabPresence
            :users="displayUsers"
            :max-visible="3"
            size="xs"
            :show-tooltip="false"
          />
          <span>{{ badgeText }}</span>
        </div>
      </template>

      <template #content>
        <div class="p-2 max-w-xs">
          <p class="text-sm font-medium mb-2">
            Currently editing:
          </p>
          <div class="flex flex-wrap gap-1.5">
            <div
              v-for="(user, index) in visibleUsers"
              :key="user.user?.id || index"
              class="user-chip flex items-center gap-1.5 bg-muted/50 rounded-full px-2 py-0.5"
              :style="{ animationDelay: `${index * 60}ms` }"
            >
              <CollabPresence
                :users="[user]"
                size="xs"
                :show-tooltip="false"
              />
              <span class="text-xs">{{ user.user?.name || 'Unknown' }}</span>
            </div>
            <div
              v-if="overflowCount > 0"
              class="user-chip flex items-center gap-1 text-xs text-muted-foreground"
              :style="{ animationDelay: `${visibleUsers.length * 60}ms` }"
            >
              +{{ overflowCount }} more
            </div>
          </div>
        </div>
      </template>
    </UTooltip>

    <!-- Simple text badge without tooltip -->
    <div
      v-else
      class="inline-flex items-center rounded-full bg-primary-50 dark:bg-primary-900/30 text-primary-600 dark:text-primary-400 font-medium"
      :class="sizeClasses.badge"
      :title="tooltipContent"
    >
      <span>{{ badgeText }}</span>
    </div>
  </div>
</template>

<style scoped>
.collab-editing-badge {
  /* Prevent layout shift while loading */
  min-height: 1em;
}


/* User chip pop-in animation (for tooltip content) */
.user-chip {
  animation: user-bounce-in 0.4s cubic-bezier(0.34, 1.56, 0.64, 1) backwards;
}

@keyframes user-bounce-in {
  0% {
    opacity: 0;
    transform: scale(0) translateY(-8px);
  }
  50% {
    opacity: 1;
    transform: scale(1.2) translateY(2px);
  }
  75% {
    transform: scale(0.9) translateY(-1px);
  }
  100% {
    opacity: 1;
    transform: scale(1) translateY(0);
  }
}
</style>
