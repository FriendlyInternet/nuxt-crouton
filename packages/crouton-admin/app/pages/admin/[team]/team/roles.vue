<script setup lang="ts">
/**
 * Team Roles Page (#4106)
 *
 * The fixed base roles (read-only) and the team's own roles: a name plus
 * ticked actions. Uses the TeamRolesSettings component.
 *
 * @route /admin/[team]/team/roles
 */
definePageMeta({
  middleware: ['auth', 'can'],
  can: 'team:manage'
})
</script>

<template>
  <div class="p-4 sm:p-6">
    <TeamRolesSettings />
  </div>
</template>
