<script setup lang="ts">
/**
 * Dashboard Layout
 *
 * Main dashboard layout with sidebar and content area.
 * Uses Nuxt UI's DashboardGroup for responsive sidebar management.
 *
 * Uses UDashboardPanel with UDashboardNavbar to provide:
 * - Mobile sidebar toggle button
 * - Proper header spacing
 * - Responsive layout structure
 *
 * Usage: Set definePageMeta({ layout: 'dashboard' }) in your page.
 */

import type { NavigationMenuItem } from '@nuxt/ui'

interface Props {
  /** Custom navigation items for the sidebar */
  navigationItems?: NavigationMenuItem[][]
  /** App logo URL */
  logo?: string
  /** App name */
  appName?: string
}

const props = defineProps<Props>()

// Get app name from auth config if not provided
const { t } = useT()
const authConfig = useAuthConfig()
const appName = computed(() => props.appName ?? authConfig?.appName ?? t('navigation.dashboard'))
</script>

<template>
  <UDashboardGroup>
    <SidebarAuthSidebar
      :navigation-items="navigationItems"
      :logo="logo"
      :app-name="appName"
    />

    <UDashboardPanel>
      <UDashboardNavbar :title="appName">
        <template #leading>
          <UDashboardSidebarCollapse />
        </template>
      </UDashboardNavbar>
      <div class="flex-1 overflow-y-auto">
        <slot />
      </div>
    </UDashboardPanel>
  </UDashboardGroup>
</template>
