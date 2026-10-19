<script setup lang="ts">
/**
 * Account Settings Page
 *
 * User account settings including profile, password, security, and danger zone.
 * Accessible from user menu dropdown.
 *
 * @route /account
 */
definePageMeta({
  middleware: ['auth']
})

const route = useRoute()
const { t } = useT()

// Get initial tab from query param
const initialTab = computed(() => {
  const tab = route.query.tab as string | undefined
  return tab ?? 'profile'
})
</script>

<template>
  <div class="min-h-screen bg-gray-50 dark:bg-gray-900">
    <div class="max-w-3xl mx-auto py-8 px-4 sm:px-6">
      <!-- Back link -->
      <NuxtLink
        to="/admin"
        class="inline-flex items-center gap-1 text-sm text-muted hover:text-foreground mb-6"
      >
        <UIcon
          name="i-lucide-arrow-left"
          class="size-4"
        />
        {{ t('common.back') }}
      </NuxtLink>

      <!-- Settings -->
      <UCard>
        <AccountSettings :default-tab="initialTab" />
      </UCard>
    </div>
  </div>
</template>
