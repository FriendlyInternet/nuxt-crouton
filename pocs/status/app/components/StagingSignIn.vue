<script setup lang="ts">
// One-tap staging sign-in: one button per role when the app supports it (#3421),
// else a single "Open and sign in".
defineProps<{ signIn?: string | null, roles?: boolean, variant?: 'solid' | 'outline' }>()

const STAGING_ROLES = [
  { role: 'member', label: 'Member' },
  { role: 'admin', label: 'Admin' },
  { role: 'superadmin', label: 'Super admin' }
]
</script>

<template>
  <div v-if="signIn && roles" class="flex gap-2">
    <UButton
      v-for="r in STAGING_ROLES"
      :key="r.role"
      size="sm"
      :variant="variant ?? 'solid'"
      class="flex-1 justify-center"
      :label="r.label"
      :href="`${signIn}&role=${r.role}`"
      target="_blank"
    />
  </div>
  <UButton v-else-if="signIn" block :variant="variant ?? 'solid'" icon="i-lucide-log-in" label="Open and sign in" :href="signIn" target="_blank" />
</template>
