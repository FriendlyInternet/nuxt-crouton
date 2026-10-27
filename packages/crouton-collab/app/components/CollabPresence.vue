<script setup lang="ts">
import { computed } from 'vue'
import type { CollabAwarenessState } from '../types/collab'
import { generateUserColor, getInitials, getTextColor } from '../utils/avatar'

/**
 * CollabPresence - User presence avatars
 *
 * Shows stacked avatars of users in the collaboration room.
 * Each avatar displays the user's initials with their color.
 *
 * @example
 * ```vue
 * <CollabPresence
 *   :users="presence.otherUsers"
 *   :max-visible="4"
 *   size="sm"
 * />
 * ```
 */
interface Props {
  users: CollabAwarenessState[]
  maxVisible?: number
  size?: 'xs' | 'sm' | 'md'
  showTooltip?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  maxVisible: 5,
  size: 'sm',
  showTooltip: true
})

// Visible users (capped by maxVisible)
const visibleUsers = computed(() => props.users.slice(0, props.maxVisible))

// Overflow count
const overflowCount = computed(() => {
  const overflow = props.users.length - props.maxVisible
  return overflow > 0 ? overflow : 0
})


const sizeClasses = computed(() => ({
  xs: 'size-6 text-[10px]',
  sm: 'size-8 text-sm',
  md: 'size-10 text-base'
}[props.size] ?? 'size-8 text-sm'))

const overlapOffset = computed(() => ({
  xs: '-ml-2',
  sm: '-ml-2.5',
  md: '-ml-3'
}[props.size] ?? '-ml-2.5'))

const avatarBase = 'collab-presence-avatar rounded-full flex items-center justify-center font-medium border-2 border-white dark:border-gray-900 shadow-sm overflow-hidden'

function colorOf(state: CollabAwarenessState): string {
  const user = state.user
  return user?.color || (user?.id ? generateUserColor(user.id) : '#6b7280')
}
</script>

<template>
  <div
    v-if="users.length > 0"
    class="collab-presence flex items-center"
  >
    <template
      v-for="(userState, index) in visibleUsers"
      :key="userState.user?.id || index"
    >
      <UTooltip
        :text="userState.user?.name || ''"
        :disabled="!showTooltip || !userState.user?.name"
      >
        <div
          :class="[avatarBase, sizeClasses, index > 0 ? overlapOffset : '']"
          :style="{
            backgroundColor: colorOf(userState),
            color: getTextColor(colorOf(userState)),
            zIndex: visibleUsers.length - index
          }"
          :title="showTooltip ? undefined : userState.user?.name"
        >
          <img
            v-if="userState.user?.image"
            :src="userState.user.image"
            :alt="userState.user.name"
            class="size-full object-cover"
          >
          <template v-else>
            {{ getInitials(userState.user?.name || '') }}
          </template>
        </div>
      </UTooltip>
    </template>

    <UTooltip
      v-if="overflowCount > 0"
      :text="`+${overflowCount} more`"
      :disabled="!showTooltip"
    >
      <div
        :class="[avatarBase, sizeClasses, overlapOffset, 'bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-300']"
        :style="{ zIndex: 0 }"
      >
        +{{ overflowCount }}
      </div>
    </UTooltip>
  </div>
</template>
