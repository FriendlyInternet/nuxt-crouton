<script setup lang="ts">
/**
 * Team Admin Layout
 *
 * Layout for team admin pages (/admin/[team]/*).
 * Provides sidebar + slot - pages provide their own UDashboardPanel.
 *
 * This allows each section (bookings, team settings, etc.) to:
 * - Have its own title in UDashboardNavbar
 * - Add horizontal tabs via UNavigationMenu
 * - Control their own panel structure
 */
</script>

<template>
  <UDashboardGroup>
    <CroutonUserPill placement="fixed" />
    <CroutonAdminSidebar context="team" />
    <div class="flex flex-col flex-1 min-w-0 min-h-0">
      <ImpersonationBanner />
      <div class="flex flex-1 min-h-0 overflow-hidden [&>div]:min-h-0 pb-[calc(3.5rem+env(safe-area-inset-bottom))] lg:pb-0"> <!-- reserve room for the fixed CroutonUserPill (phone only; on lg it sits over the sidebar) -->
        <slot />
      </div>
    </div>
  </UDashboardGroup>
</template>
