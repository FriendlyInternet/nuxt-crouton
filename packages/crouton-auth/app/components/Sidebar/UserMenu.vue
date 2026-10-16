<script setup lang="ts">
/**
 * UserMenu Component
 *
 * User avatar with dropdown menu for account actions.
 * Displayed in the sidebar footer.
 * Menu items are shared via useUserMenuItems() with CroutonPagesNav.
 *
 * @example
 * ```vue
 * <SidebarUserMenu :collapsed="collapsed" />
 * ```
 */

interface Props {
  /** Whether the sidebar is collapsed */
  collapsed?: boolean
}

defineProps<Props>()

const { t } = useT()
const { user, loading, userInitials, dropdownItems } = useUserMenuItems()
</script>

<template>
  <UDropdownMenu
    :items="dropdownItems"
    :content="{ align: 'start', side: 'top' }"
    :ui="{ content: 'w-56' }"
  >
    <UButton
      :loading="loading"
      variant="ghost"
      color="neutral"
      :class="[
        'w-full',
        collapsed ? 'justify-center px-2' : 'justify-start'
      ]"
    >
      <template #leading>
        <UAvatar
          :src="user?.image ?? undefined"
          :alt="user?.name ?? t('account.user')"
          :text="userInitials"
          size="sm"
        />
      </template>

      <template
        v-if="!collapsed"
        #default
      >
        <div class="flex flex-col items-start min-w-0 flex-1">
          <span class="text-sm font-medium truncate max-w-full">
            {{ user?.name || t('account.user') }}
          </span>
          <span class="text-xs text-muted truncate max-w-full">
            {{ user?.email }}
          </span>
        </div>
      </template>

      <template
        v-if="!collapsed"
        #trailing
      >
        <UIcon
          name="i-lucide-chevrons-up-down"
          class="size-4 text-muted shrink-0"
        />
      </template>
    </UButton>
  </UDropdownMenu>
</template>
