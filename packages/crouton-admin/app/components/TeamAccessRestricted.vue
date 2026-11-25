<script setup lang="ts">
/**
 * TeamAccessRestricted — the "you may not open this team screen" panel with a
 * link back to the team overview. Shared by the team admin pages that check
 * `useCan(...)` (#4105), so the panel lives in one place.
 */
const { teamSlug } = useTeamContext()
const { t } = useT()
</script>

<template>
  <div class="text-center py-8">
    <UIcon
      name="i-lucide-shield-alert"
      class="size-12 mx-auto mb-4 text-muted opacity-50"
    />
    <h3 class="text-lg font-medium">{{ t('common.accessRestricted') || 'Access Restricted' }}</h3>
    <p class="text-muted mt-2 max-w-md mx-auto">{{ t('teams.adminAccessRequired') || 'Admin access required' }}</p>
    <NuxtLink :to="`/admin/${teamSlug}/team`">
      <UButton
        :label="t('navigation.backToTeam') || 'Back to Team'"
        variant="outline"
        class="mt-4"
      />
    </NuxtLink>
  </div>
</template>
