<script setup lang="ts">
/**
 * Create Team Onboarding Page
 *
 * Shown to new users in multi-tenant mode who don't have any teams yet.
 * Uses the TeamCreateForm component to handle team creation.
 */
import type { Team } from '../../../types'

definePageMeta({
  middleware: 'auth',
  layout: 'auth'
})

const { t } = useT()
const { logout } = useAuth()

const navigating = ref(false)

async function onCancel() {
  await logout()
  navigateTo('/auth/login')
}

function onTeamCreated(team: Team) {
  // Show loading during navigation
  navigating.value = true
  // Force full page load so SSR picks up the fresh session with active org
  // Navigate to admin since the team has no public pages yet
  navigateTo(`/admin/${team.slug}`, { external: true })
}
</script>

<template>
  <div class="min-h-screen flex items-center justify-center p-6 bg-default">
    <!-- Full-screen overlay during navigation -->
    <Transition
      enter-active-class="transition-opacity duration-300 ease-out"
      enter-from-class="opacity-0"
      leave-active-class="transition-opacity duration-200 ease-in"
      leave-to-class="opacity-0"
    >
      <div
        v-if="navigating"
        class="fixed inset-0 z-50 flex flex-col items-center justify-center bg-default"
      >
        <div class="flex flex-col items-center gap-5 text-center">
          <div class="relative flex h-20 w-20 items-center justify-center">
            <div class="absolute inset-0 animate-ping rounded-2xl bg-primary/15" />
            <div class="relative flex h-20 w-20 items-center justify-center rounded-2xl bg-primary/10">
              <UIcon
                name="i-lucide-building-2"
                class="h-10 w-10 text-primary"
              />
            </div>
          </div>
          <div>
            <p class="text-lg font-semibold text-highlighted">
              {{ t('onboarding.settingUpWorkspace') }}
            </p>
            <p class="mt-1 text-sm text-muted">
              {{ t('onboarding.justAMoment') }}
            </p>
          </div>
          <UIcon
            name="i-lucide-loader-2"
            class="h-5 w-5 animate-spin text-muted"
          />
        </div>
      </div>
    </Transition>

    <UCard class="w-full max-w-md">
      <template #header>
        <div class="flex items-center gap-3">
          <div class="flex items-center justify-center w-10 h-10 rounded-lg bg-primary/10">
            <UIcon
              name="i-lucide-building-2"
              class="w-5 h-5 text-primary"
            />
          </div>
          <div>
            <h1 class="text-lg font-semibold">
              {{ t('onboarding.createTeamTitle') }}
            </h1>
            <p class="text-sm text-muted">
              {{ t('onboarding.createTeamDescription') }}
            </p>
          </div>
        </div>
      </template>

      <TeamCreateForm
        :loading="navigating"
        @success="onTeamCreated"
        @cancel="onCancel"
      />
    </UCard>
  </div>
</template>
