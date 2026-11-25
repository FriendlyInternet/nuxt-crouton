<script setup lang="ts">
/**
 * Team Settings Page
 *
 * Team configuration settings including name, slug, logo, and theme.
 * Only accessible by team admins/owners.
 *
 * @route /admin/[team]/team/settings
 */
definePageMeta({
  middleware: ['auth', 'can'],
  can: 'team:manage'
})

const { t } = useT()
const { currentTeam, isOwner, deleteTeam } = useTeam()
const canManage = useCan('team:manage')
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
  <div class="p-4 sm:p-6">
    <TeamAccessRestricted v-if="!canManage" />

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
