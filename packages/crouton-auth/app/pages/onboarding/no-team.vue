<script setup lang="ts">
/**
 * Shown to signed-in users who belong to no team and may not create one (#3130).
 */
definePageMeta({
  middleware: 'auth',
  layout: 'auth'
})

const { t } = useT()
const { logout } = useAuth()

async function onLogout() {
  await logout()
  navigateTo('/auth/login')
}
</script>

<template>
  <div class="min-h-screen flex items-center justify-center p-6 bg-default">
    <UCard class="w-full max-w-md">
      <div class="flex flex-col items-center gap-4 text-center">
        <UIcon name="i-lucide-mail-plus" class="w-10 h-10 text-primary" />
        <h1 class="text-lg font-semibold">
          {{ t('onboarding.noTeamTitle') }}
        </h1>
        <p class="text-sm text-muted">
          {{ t('onboarding.noTeamDescription') }}
        </p>
        <UButton color="neutral" variant="outline" @click="onLogout">
          {{ t('onboarding.signOut') }}
        </UButton>
      </div>
    </UCard>
  </div>
</template>
