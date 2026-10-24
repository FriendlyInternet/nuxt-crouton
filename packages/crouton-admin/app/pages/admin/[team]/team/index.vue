<script setup lang="ts">
/**
 * Team Members Page (Default Tab)
 *
 * Manage team members - view, invite, change roles, and remove members.
 *
 * @route /admin/[team]/team
 */
const { t } = useT()

// Invite modal state
const showInviteModal = ref(false)

function handleInvite() {
  showInviteModal.value = true
}

function handleInvited() {
  showInviteModal.value = false
}
</script>

<template>
  <div class="p-4 sm:p-6">
    <!-- Members List -->
    <TeamMembers
      :show-invite-button="true"
      @invite="handleInvite"
    />

    <!-- Invite Modal -->
    <UModal v-model:open="showInviteModal">
      <template #content>
        <div class="p-6">
          <TeamMemberInviteForm
            @cancel="showInviteModal = false"
            @success="handleInvited"
          />
        </div>
      </template>
    </UModal>
  </div>
</template>
