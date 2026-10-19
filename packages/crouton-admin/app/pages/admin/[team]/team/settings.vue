<script setup lang="ts">
/**
 * Team Settings Page
 *
 * Team configuration settings including name, slug, logo, and theme.
 * Only accessible by team admins/owners.
 *
 * @route /admin/[team]/team/settings
 */
const { teamSlug } = useTeamContext()
const { t } = useT()
const { currentTeam, isOwner, deleteTeam, isAdmin } = useTeam()
const notify = useNotify()

// Show delete confirmation modal
const showDeleteModal = ref(false)

// Handle team deletion
async function handleDelete() {
  try {
    await deleteTeam()
    notify.success(t('teams.teamDeleted'), { description: t('teams.teamDeletedDescription') })
    // Redirect to home (will need to select new team)
    await navigateTo('/')
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : t('errors.generic')
    notify.error(t('common.error'), { description: message })
  }
}

// Handle saved event from TeamSettings component
function handleSaved() {
  notify.success(t('common.saved'), { description: t('teams.settingsSaved') })
}

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

    <!-- Team General Settings -->
    <template v-else>
      <TeamSettings
        @saved="handleSaved"
        @delete="showDeleteModal = true"
      />

      <!-- Delete Confirmation Modal -->
      <TeamDeleteConfirm
        v-if="currentTeam && isOwner"
        v-model:open="showDeleteModal"
        :team-name="currentTeam.name"
        @confirm="handleDelete"
      />
    </template>
  </div>
</template>
