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
      <!-- Phone: keep the fixed user pill clear of page navbars (right slot gets end padding) -->
      <div class="flex flex-1 min-h-0 overflow-hidden [&>div]:min-h-0 max-sm:[&_[data-slot=right]]:pe-14">
        <UDashboardPanel>
          <UDashboardNavbar :title="t('home.superAdmin')">
            <template #leading>
              <UDashboardSidebarCollapse />
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
