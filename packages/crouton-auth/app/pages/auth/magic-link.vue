<script setup lang="ts">
/**
 * Magic Link Page
 *
 * Handles magic link callback when user clicks the link in their email.
 * URL: /auth/magic-link?token=xxx
 *
 * This page automatically verifies the magic link token and signs the user in.
 */
import { requireAuthClient } from '../../../types/auth-client'

definePageMeta({
  layout: 'auth'
})

const { t } = useT()
const route = useRoute()
const router = useRouter()
const notify = useNotify()

const { hasMagicLink } = useAuth()
const redirects = useAuthRedirects()

// Get token from query params
const token = computed(() => route.query.token as string | undefined)

// State
const verifying = ref(false)
const verified = ref(false)
const verifyError = ref<string | null>(null)

// Verify magic link on mount
onMounted(async () => {
  if (token.value) {
    await verifyMagicLink()
  }
})

// Verify magic link token
async function verifyMagicLink() {
  if (!token.value) return

  verifying.value = true
  verifyError.value = null

  try {
    // Better Auth 1.4.x requires query wrapper for token
    const result = await requireAuthClient().magicLink.verify({
      query: { token: token.value! }
    })

    if (result.error) {
      throw new Error(result.error.message ?? t('auth.magicLink.verificationFailed'))
    }

    verified.value = true
    notify.success(t('auth.magicLink.signedIn'), { description: t('auth.magicLink.signedInDescription') })

    // Redirect after short delay
    setTimeout(() => {
      router.push(redirects.afterLogin)
    }, 1500)
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : t('auth.magicLink.verificationFailed')
    verifyError.value = message
    notify.error(t('auth.magicLink.signInFailed'), { description: message })
  } finally {
    verifying.value = false
  }
}
</script>

<template>
  <div>
    <!-- Header -->
    <div class="text-center">
      <h1 class="text-2xl font-bold text-highlighted">
        {{ $t('auth.magicLink.title') }}
      </h1>
    </div>

    <!-- Magic link not enabled -->
    <div
      v-if="!hasMagicLink"
      class="mt-8"
    >
      <UAlert
        color="warning"
        icon="i-lucide-alert-triangle"
        :title="$t('auth.magicLink.notEnabled')"
        :description="$t('auth.magicLink.notEnabledDescription')"
      />
      <NuxtLink
        to="/auth/login"
        class="block mt-6"
      >
        <UButton block>
          {{ $t('auth.magicLink.signInWithAnotherMethod') }}
        </UButton>
      </NuxtLink>
    </div>

    <!-- No token -->
    <div
      v-else-if="!token"
      class="mt-8"
    >
      <UAlert
        color="error"
        icon="i-lucide-alert-triangle"
        :title="$t('auth.magicLink.invalidLink')"
        :description="$t('auth.magicLink.invalidLinkDescription')"
      />
      <NuxtLink
        to="/auth/login"
        class="block mt-6"
      >
        <UButton block>
          {{ $t('auth.magicLink.requestNewLink') }}
        </UButton>
      </NuxtLink>
    </div>

    <!-- Verifying state -->
    <div
      v-else-if="verifying"
      class="mt-8 text-center"
    >
      <UIcon
        name="i-lucide-loader-circle"
        class="size-12 animate-spin text-primary"
      />
      <p class="mt-4 text-muted">
        {{ $t('auth.magicLink.signingYouIn') }}
      </p>
    </div>

    <!-- Verified successfully -->
    <div
      v-else-if="verified"
      class="mt-8"
    >
      <UAlert
        color="success"
        icon="i-lucide-check-circle"
        :title="$t('auth.magicLink.signedIn')"
        :description="$t('auth.magicLink.signedInRedirecting')"
      />
      <div class="mt-4 text-center">
        <UIcon
          name="i-lucide-loader-circle"
          class="size-6 animate-spin text-primary"
        />
      </div>
    </div>

    <!-- Verification error -->
    <div
      v-else-if="verifyError"
      class="mt-8"
    >
      <UAlert
        color="error"
        icon="i-lucide-alert-triangle"
        :title="$t('auth.magicLink.signInFailed')"
        :description="verifyError"
      />
      <div class="mt-6 space-y-3">
        <NuxtLink to="/auth/login">
          <UButton block>
            {{ $t('auth.magicLink.tryAgain') }}
          </UButton>
        </NuxtLink>
        <p class="text-center text-sm text-muted">
          {{ $t('auth.magicLink.expiredHint') }}
        </p>
      </div>
    </div>
  </div>
</template>
