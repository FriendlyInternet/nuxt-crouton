<script setup lang="ts">
/**
 * Verify Email Page
 *
 * Handles email verification callback.
 * URL: /auth/verify-email?token=xxx
 *
 * Also shows a resend verification email option.
 */
import { requireAuthClient } from '../../../types/auth-client'

definePageMeta({
  layout: 'auth'
})

const { t } = useT()
const route = useRoute()
const router = useRouter()
const notify = useNotify()

const { user, loggedIn } = useAuth()
const redirects = useAuthRedirects()

// Get token from query params
const token = computed(() => route.query.token as string | undefined)

// State
const verifying = ref(false)
const verified = ref(false)
const verifyError = ref<string | null>(null)
const resending = ref(false)
const resent = ref(false)

// Verify email on mount if token present
onMounted(async () => {
  if (token.value) {
    await verifyEmail()
  }
})

// Verify email with token
async function verifyEmail() {
  if (!token.value) return

  verifying.value = true
  verifyError.value = null

  try {
    // Better Auth 1.4.x requires query wrapper for token
    const result = await requireAuthClient().verifyEmail({
      query: { token: token.value! }
    })

    if (result.error) {
      throw new Error(result.error.message ?? t('auth.verifyEmail.verificationFailed'))
    }

    verified.value = true
    notify.success(t('auth.verifyEmail.emailVerified'), { description: t('auth.verifyEmail.emailVerifiedDescription') })
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : t('auth.verifyEmail.verificationFailed')
    verifyError.value = message
    notify.error(t('auth.verifyEmail.verificationFailed'), { description: message })
  } finally {
    verifying.value = false
  }
}

// Resend verification email
async function resendVerification() {
  if (!user.value?.email) {
    notify.error(t('common.error'), { description: t('auth.verifyEmail.signInFirstToResend') })
    return
  }

  resending.value = true

  try {
    const result = await requireAuthClient().sendVerificationEmail({
      email: user.value.email,
      callbackURL: window.location.origin + '/auth/verify-email'
    })

    if (result.error) {
      throw new Error(result.error.message ?? t('auth.verifyEmail.failedToSend'))
    }

    resent.value = true
    notify.success(t('auth.verifyEmail.emailSent'), { description: t('auth.verifyEmail.emailSentDescription') })
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : t('auth.verifyEmail.failedToSend')
    notify.error(t('common.error'), { description: message })
  } finally {
    resending.value = false
  }
}

// Navigate to authenticated redirect
function goToDashboard() {
  router.push(redirects.authenticated)
}

// Navigate to login
function goToLogin() {
  router.push('/auth/login')
}
</script>

<template>
  <div>
    <!-- Header -->
    <div class="text-center">
      <h1 class="text-2xl font-bold text-highlighted">
        {{ token ? $t('auth.verifyEmail.verifyingYourEmail') : $t('auth.verifyEmail.verifyYourEmail') }}
      </h1>
    </div>

    <!-- Verifying state -->
    <div
      v-if="verifying"
      class="mt-8 text-center"
    >
      <UIcon
        name="i-lucide-loader-circle"
        class="size-12 animate-spin text-primary"
      />
      <p class="mt-4 text-muted">
        {{ $t('auth.verifyEmail.verifyingEmailAddress') }}
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
        :title="$t('auth.verifyEmail.emailVerified')"
        :description="$t('auth.verifyEmail.emailVerifiedFullDescription')"
      />
      <UButton
        class="mt-6"
        block
        @click="loggedIn ? goToDashboard() : goToLogin()"
      >
        {{ loggedIn ? $t('auth.verifyEmail.goToDashboard') : $t('auth.signIn') }}
      </UButton>
    </div>

    <!-- Verification error -->
    <div
      v-else-if="verifyError"
      class="mt-8"
    >
      <UAlert
        color="error"
        icon="i-lucide-alert-triangle"
        :title="$t('auth.verifyEmail.verificationFailed')"
        :description="verifyError"
      />
      <div class="mt-6 space-y-3">
        <UButton
          v-if="loggedIn"
          block
          :loading="resending"
          @click="resendVerification"
        >
          {{ $t('auth.verifyEmail.resendVerificationEmail') }}
        </UButton>
        <NuxtLink to="/auth/login">
          <UButton
            color="neutral"
            variant="outline"
            block
          >
            {{ $t('auth.backToSignIn') }}
          </UButton>
        </NuxtLink>
      </div>
    </div>

    <!-- No token - show instructions -->
    <div
      v-else
      class="mt-8"
    >
      <div class="text-center text-muted">
        <UIcon
          name="i-lucide-mail"
          class="size-12 mx-auto mb-4"
        />
        <p>
          {{ $t('auth.verifyEmail.checkInbox') }}
        </p>
        <p class="mt-2">
          {{ $t('auth.verifyEmail.clickLink') }}
        </p>
      </div>

      <!-- Logged in: option to resend -->
      <div
        v-if="loggedIn && user?.email"
        class="mt-8 space-y-4"
      >
        <UAlert
          v-if="resent"
          color="primary"
          icon="i-lucide-mail-check"
          :title="$t('auth.verifyEmail.emailSent')"
          :description="$t('auth.verifyEmail.emailSentTo', { email: user.email })"
        />

        <UButton
          v-if="!resent"
          block
          :loading="resending"
          @click="resendVerification"
        >
          {{ $t('auth.verifyEmail.resendVerificationEmail') }}
        </UButton>

        <NuxtLink :to="redirects.authenticated">
          <UButton
            color="neutral"
            variant="outline"
            block
          >
            {{ $t('auth.verifyEmail.goToDashboard') }}
          </UButton>
        </NuxtLink>
      </div>

      <!-- Not logged in -->
      <div
        v-else
        class="mt-8"
      >
        <NuxtLink to="/auth/login">
          <UButton block>
            {{ $t('auth.signIn') }}
          </UButton>
        </NuxtLink>
      </div>
    </div>
  </div>
</template>
