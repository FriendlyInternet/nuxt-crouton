<script setup lang="ts">
/**
 * Booking Block Public Renderer
 *
 * Renders a booking panel on public pages.
 * BlockContent.vue already wraps this in <ClientOnly> (clientOnly: true in definition).
 *
 * Logged-out visitors get a login prompt (default) or nothing (`loggedOut: 'hide'`).
 *
 * NOTE: This component must NOT use top-level await (no async setup).
 */

interface BookingBlockAttrs {
  title?: string
  emptyMessage?: string
  /** What a logged-out visitor sees (#2263). Older pages may still carry `access`. */
  loggedOut?: 'prompt' | 'hide'
  scope?: 'personal' | 'team'
}

interface Props {
  attrs: BookingBlockAttrs
}

const props = defineProps<Props>()

const { loggedIn } = useAuth()
const { t } = useI18n()
const route = useRoute()

// Booking needs an account: a logged-out visitor gets a login prompt (default)
// or nothing. Pages saved with the old `access` attr fall back to the prompt.
const loggedOutMode = computed(() => props.attrs.loggedOut ?? 'prompt')
const requiresLogin = computed(() => !loggedIn.value)
const hiddenForVisitor = computed(() => requiresLogin.value && loggedOutMode.value === 'hide')

const loginUrl = computed(() => `/auth/login?redirect=${encodeURIComponent(route.fullPath)}`)
</script>

<template>
  <div v-if="!hiddenForVisitor" class="booking-block">
    <!-- Logged out: show a login prompt (booking needs an account) -->
    <div
      v-if="requiresLogin"
      class="bg-muted/80 backdrop-blur-sm rounded-3xl border border-default shadow-lg shadow-neutral-950/5 p-8 text-center"
    >
      <div class="mx-auto max-w-sm space-y-4">
        <div class="inline-flex items-center justify-center w-12 h-12 rounded-full bg-primary/10">
          <UIcon name="i-lucide-lock" class="w-6 h-6 text-primary" />
        </div>
        <h3 class="text-lg font-semibold text-default">
          {{ attrs.title || t('bookings.title') }}
        </h3>
        <p class="text-sm text-muted">
          {{ t('bookings.panel.membersOnly') }}
        </p>
        <UButton
          :to="loginUrl"
          color="primary"
          size="lg"
          icon="i-lucide-log-in"
        >
          {{ t('bookings.panel.signIn') }}
        </UButton>
      </div>
    </div>

    <!-- Logged in: show the booking panel -->
    <div
      v-else
      class="bg-default backdrop-blur-sm rounded-3xl border border-default shadow-lg shadow-neutral-950/5 overflow-clip"
    >
      <CroutonBookingsPanel
        :title="attrs.title || undefined"
        :empty-message="attrs.emptyMessage || undefined"
        :scope="attrs.scope || 'personal'"
      />
    </div>
  </div>
</template>

<style scoped>
/* Strip Panel's own container styling — the frosted wrapper provides it */
.booking-block :deep(.booking-panel) {
  border: none;
  border-radius: 0;
  background: transparent;
}

</style>
