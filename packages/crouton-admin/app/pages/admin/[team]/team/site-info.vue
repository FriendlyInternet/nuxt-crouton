<script setup lang="ts">
/**
 * Site Info Page
 *
 * Team favicon and site information settings (contact email, URLs, social links).
 * Only accessible by team admins/owners.
 *
 * @route /admin/[team]/team/site-info
 */
const { teamSlug } = useTeamContext()
const { t } = useT()
const { isAdmin } = useTeam()
</script>

<template>
  <div class="p-6">
    <!-- Not a team admin -->
    <div
      v-if="!isAdmin"
      class="text-center py-8"
    >
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

    <div v-else class="space-y-8">
      <TeamFaviconSettings />
      <USeparator />
      <TeamSiteInfoSettings />
    </div>
  </div>
</template>
