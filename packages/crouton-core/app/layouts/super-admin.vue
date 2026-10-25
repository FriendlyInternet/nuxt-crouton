<script setup lang="ts">
/**
 * Super Admin Layout
 *
 * Layout for super admin pages (/super-admin/*).
 * Uses the AdminSidebar component with super admin context.
 *
 * Uses UDashboardPanel with UDashboardNavbar to provide:
 * - Mobile sidebar toggle button
 * - Proper header spacing
 * - Responsive layout structure
 */
const { t } = useT()
</script>

<template>
  <UDashboardGroup>
    <CroutonUserPill placement="fixed" />
    <CroutonAdminSidebar context="super" />
    <div class="flex flex-col flex-1 min-w-0 min-h-0">
      <ImpersonationBanner />
      <div class="flex flex-1 min-h-0 overflow-hidden [&>div]:min-h-0">
        <UDashboardPanel>
          <UDashboardNavbar :title="t('home.superAdmin')">
            <template #leading>
              <UDashboardSidebarCollapse class="hidden lg:flex" />
            </template>
          </UDashboardNavbar>
          <div class="flex-1 overflow-y-auto">
            <slot />
          </div>
        </UDashboardPanel>
      </div>
    </div>
  </UDashboardGroup>
</template>
