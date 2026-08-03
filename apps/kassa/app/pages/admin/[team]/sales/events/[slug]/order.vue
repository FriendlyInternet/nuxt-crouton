<script setup lang="ts">
/**
 * Admin POS page
 *
 * Full-page ordering interface for one event inside the admin (Kassa tab).
 * <SalesPosPanel> owns the whole flow: logged-in team members get an admin
 * helper token automatically (no PIN form) and editing affordances (add
 * category / add product); anonymous visitors fall back to PIN login.
 *
 * @route /admin/[team]/sales/events/[slug]/order
 */
definePageMeta({ middleware: ['auth'] })

const { t } = useT()
const route = useRoute()

const teamSlug = computed(() => String(route.params.team || ''))
const eventSlug = computed(() => String(route.params.slug || ''))
const workspacePath = computed(() => `/admin/${teamSlug.value}/sales/events/${eventSlug.value}`)
</script>

<template>
  <div class="p-6 space-y-4">
    <div class="flex items-center gap-2">
      <UButton
        icon="i-lucide-arrow-left"
        color="neutral"
        variant="ghost"
        size="sm"
        :label="t('sales.events.workspace')"
        :to="workspacePath"
      />
    </div>

    <div class="rounded-xl border border-default overflow-clip bg-default h-[calc(100dvh-12rem)]">
      <SalesPosPanel :event-slug="eventSlug" :team-param="teamSlug" />
    </div>
  </div>
</template>
