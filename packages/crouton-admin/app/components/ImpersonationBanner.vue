<script setup lang="ts">
/**
 * ImpersonationBanner Component
 *
 * Fixed top banner that shows when an admin is impersonating a user.
 * Provides a button to stop impersonation and return to admin view.
 */

const {
  isImpersonating,
  impersonatedUser,
  loading,
  stopImpersonation
} = useImpersonation()

const notify = useNotify()
const { t } = useT()

async function handleStop() {
  try {
    await stopImpersonation()
  } catch (e) {
    notify.error(t('admin.impersonation.stopFailed'), { description: e instanceof Error ? e.message : t('errors.unknown') })
  }
}
</script>

<template>
  <Transition
    enter-active-class="transition-transform duration-200 ease-out"
    enter-from-class="-translate-y-full"
    enter-to-class="translate-y-0"
    leave-active-class="transition-transform duration-150 ease-in"
    leave-from-class="translate-y-0"
    leave-to-class="-translate-y-full"
  >
    <div
      v-if="isImpersonating"
      class="fixed inset-x-0 top-0 z-50 flex items-center justify-center gap-3 bg-amber-500 px-4 py-2 text-amber-950 shadow-md"
    >
      <UIcon
        name="i-lucide-eye"
        class="size-5"
      />
      <span class="text-sm font-medium">
        {{ t('admin.impersonation.viewingAs') }}
        <strong>{{ impersonatedUser?.name }}</strong>
        ({{ impersonatedUser?.email }})
      </span>
      <UButton
        color="neutral"
        variant="solid"
        size="xs"
        :loading="loading"
        class="ml-2 bg-amber-900 text-white hover:bg-amber-800"
        @click="handleStop"
      >
        {{ t('admin.impersonation.stop') }}
      </UButton>
    </div>
  </Transition>
</template>
