<script setup lang="ts">
/**
 * AuthRouteModal
 *
 * Shows auth forms (login / register / forgot-password) in a UModal overlay
 * when navigating to /auth/* from within the app. The router plugin intercepts
 * these navigations and opens this modal instead of performing a page transition.
 *
 * Fresh page loads still use the full auth layout — this only activates for
 * in-app navigations.
 */
import type { FormSubmitEvent, AuthFormField, ButtonProps } from '@nuxt/ui'

const { t } = useT()
const notify = useNotify()
const authModal = useAuthModal()
const { state } = authModal

// Hide the "Go home" escape hatch for apps with no public landing page
// (where '/' just bounces signed-out users back here). Default: shown.
// Also hidden when the modal is dismissable — then the X / Esc / outside-click
// already returns you to the page behind (its own gate), so a "Go home" that
// jumps to '/' would be the wrong, confusing exit.
const authConfig = useAuthConfig()
const showGoHome = computed(() => !state.value.dismissible && authConfig?.ui?.showGoHome !== false)

// Bind UModal open state — setter restores URL when user dismisses
const isOpen = computed({
  get: () => state.value.open,
  set: (val: boolean) => {
    if (!val) authModal.close()
  }
})

// Explicit exit: user chooses to leave the protected route entirely.
// For a hard auth requirement the modal is non-dismissable (outside-click /
// Esc / X disabled) — the page behind requires auth, so the only way out is to
// succeed or to deliberately navigate away. When opened as a dismissable
// "staff door" the X / Esc / outside-click are enabled and restore the page
// behind (see `dismissible` in useAuthModal).
async function handleGoHome() {
  state.value.open = false
  await navigateTo('/')
}

// Auth capabilities
const {
  login,
  register,
  loginWithOAuth,
  loginWithMagicLink,
  hasPassword,
  hasOAuth,
  hasMagicLink,
  oauthProviders
} = useAuth()
const { forgotPassword } = usePasswordReset()
const { hasPasskeys, loginWithPasskey, isWebAuthnSupported } = usePasskeys()

// ── Shared state ──────────────────────────────────────────────────────────────

const formError = ref<string | null>(null)
const submitting = ref(false)

// Reset per-form state whenever mode changes
watch(() => state.value.mode, () => {
  formError.value = null
  submitting.value = false
  showMagicLink.value = false
  magicLinkSent.value = false
  magicLinkEmail.value = ''
  emailSent.value = false
  sentEmail.value = ''
})

// Screen reader title mapped from current mode
const modalTitle = computed(() => {
  switch (state.value.mode) {
    case 'register': return t('auth.createYourAccount')
    case 'forgot-password': return t('auth.resetYourPassword')
    default: return t('auth.welcomeBack')
  }
})

// Close modal, restore URL, refresh teams, then navigate
async function handleSuccess() {
  const redirectTo = state.value.redirectTo
  state.value.open = false
  // The router plugin used pushState to show /auth/* without navigating,
  // so Vue Router's current route never changed. Restore the URL manually
  // since navigateTo is a no-op when the router already thinks we're there.
  if (import.meta.client) {
    window.history.replaceState(null, '', redirectTo)
  }
  // Refresh teams list now that we're authenticated (nanostore doesn't auto-populate)
  useTeam().refreshTeams()
  await navigateTo(redirectTo, { replace: true })
}

// ── OAuth / passkey providers (shared across login & register) ────────────────

const providerConfig: Record<string, { icon: string, name: string }> = {
  github: { icon: 'i-lucide-github', name: 'GitHub' },
  google: { icon: 'i-simple-icons-google', name: 'Google' },
  discord: { icon: 'i-simple-icons-discord', name: 'Discord' },
  twitter: { icon: 'i-lucide-twitter', name: 'X' },
  facebook: { icon: 'i-lucide-facebook', name: 'Facebook' },
  apple: { icon: 'i-simple-icons-apple', name: 'Apple' },
  microsoft: { icon: 'i-simple-icons-microsoft', name: 'Microsoft' },
  linkedin: { icon: 'i-lucide-linkedin', name: 'LinkedIn' }
}

const passkeyAvailable = computed(() => hasPasskeys.value && isWebAuthnSupported())

const oauthButtons = computed<ButtonProps[]>(() => {
  const result: ButtonProps[] = []
  if (hasOAuth.value && oauthProviders.value.length > 0) {
    for (const provider of oauthProviders.value) {
      const cfg = providerConfig[provider] || { icon: 'i-lucide-user', name: provider }
      result.push({ label: `Continue with ${cfg.name}`, icon: cfg.icon, onClick: () => handleOAuth(provider) })
    }
  }
  if (passkeyAvailable.value) {
    result.push({ label: 'Sign in with Passkey', icon: 'i-lucide-fingerprint', onClick: handlePasskey })
  }
  return result
})

async function handleOAuth(provider: string) {
  formError.value = null
  try {
    await loginWithOAuth(provider)
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'OAuth login failed'
    formError.value = message
    notify.error('Error', { description: message })
  }
}

async function handlePasskey() {
  formError.value = null
  try {
    await loginWithPasskey()
    await handleSuccess()
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'Passkey login failed'
    formError.value = message
    notify.error('Error', { description: message })
  }
}

// ── Login ─────────────────────────────────────────────────────────────────────

const showMagicLink = ref(false)
const magicLinkSent = ref(false)
const magicLinkEmail = ref('')

const loginFields = computed<AuthFormField[]>(() => {
  if (showMagicLink.value) {
    return [{ name: 'email', type: 'email', label: t('auth.email'), placeholder: 'you@example.com', required: true }]
  }
  return [
    { name: 'email', type: 'email', label: t('auth.email'), placeholder: 'you@example.com', required: true },
    { name: 'password', type: 'password', label: t('auth.password'), placeholder: 'Enter your password', required: true },
    { name: 'rememberMe', type: 'checkbox', label: t('auth.rememberMe') }
  ]
})

const loginSubmitButton = computed(() => ({
  label: showMagicLink.value ? t('auth.sendMagicLink') : t('auth.signIn'),
  loading: submitting.value,
  block: true
}))

// Prefill credentials from a shared link (e.g. /auth/login?email=…&password=…).
// Fills the fields only — the user still clicks Sign in (we never auto-submit).
// Re-apply whenever the form ref appears OR the prefill values change, with
// `immediate` + `flush:'post'` so the exposed UAuthForm state is ready: the old
// one-shot `watch(loginFormRef)` silently did nothing if the prefill state
// wasn't present the instant the ref first resolved, or if it arrived after the
// form mounted (#1153).
const loginFormRef = useTemplateRef('loginForm')
watch(
  [loginFormRef, () => state.value.prefillEmail, () => state.value.prefillPassword] as const,
  ([form, email, password]) => {
    if (!form?.state) return
    if (email) form.state.email = email
    if (password) form.state.password = password
  },
  { immediate: true, flush: 'post' },
)

async function onLoginSubmit(event: FormSubmitEvent<{ email: string, password?: string, rememberMe?: boolean }>) {
  formError.value = null
  submitting.value = true

  if (showMagicLink.value) {
    await handleMagicLink(event.data.email)
    submitting.value = false
    return
  }

  // The login UAuthForm carries no schema, so `required` is cosmetic — guard an
  // empty submit here rather than let the server reject it with a raw Zod error
  // ("[body.email] expected string, received undefined") (#1153).
  if (!event.data.email || !event.data.password) {
    formError.value = t('auth.enterEmailAndPassword')
    submitting.value = false
    return
  }

  try {
    await login({ email: event.data.email, password: event.data.password!, rememberMe: event.data.rememberMe || false })
    await handleSuccess()
  } catch (e: unknown) {
    submitting.value = false
    const message = e instanceof Error ? e.message : 'Login failed'
    formError.value = message
    notify.error('Error', { description: message })
  }
}

async function handleMagicLink(email: string) {
  try {
    await loginWithMagicLink(email)
    magicLinkSent.value = true
    magicLinkEmail.value = email
    notify.success('Check your email', { description: 'We sent you a magic link to sign in.' })
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'Magic link failed'
    formError.value = message
    notify.error('Error', { description: message })
  }
}

// ── Register ──────────────────────────────────────────────────────────────────

const minPasswordLength = 8

const registerFields = computed<AuthFormField[]>(() => [
  { name: 'name', type: 'text', label: t('forms.fullName'), placeholder: 'John Doe', required: true },
  { name: 'email', type: 'email', label: t('auth.email'), placeholder: 'you@example.com', required: true, readonly: !!state.value.prefillEmail },
  { name: 'password', type: 'password', label: t('auth.password'), placeholder: `At least ${minPasswordLength} characters`, required: true },
  { name: 'confirmPassword', type: 'password', label: t('auth.confirmPassword'), placeholder: 'Confirm your password', required: true }
])

const registerFormRef = useTemplateRef('registerForm')

// Prefill email when the register form renders with a prefillEmail (e.g. from invitation)
watch(registerFormRef, (ref) => {
  if (ref?.state && state.value.prefillEmail) {
    ref.state.email = state.value.prefillEmail
  }
})

const registerSubmitButton = computed(() => ({
  label: t('auth.createAccount'),
  loading: submitting.value,
  block: true
}))

function validateRegister(formState: Record<string, unknown>) {
  const errors: { name: string, message: string }[] = []
  if (!formState.name) errors.push({ name: 'name', message: t('errors.requiredField') })
  if (!formState.email) errors.push({ name: 'email', message: t('errors.requiredField') })
  else if (!/^[^\s@]+@[^\s@][^\s.@]*\.[^\s@]+$/.test(formState.email as string))
    errors.push({ name: 'email', message: t('errors.invalidEmail') })
  if (!formState.password) errors.push({ name: 'password', message: t('errors.requiredField') })
  else if ((formState.password as string).length < minPasswordLength)
    errors.push({ name: 'password', message: t('errors.minLength', { params: { min: minPasswordLength } }) })
  if (formState.password !== formState.confirmPassword)
    errors.push({ name: 'confirmPassword', message: t('errors.passwordMismatch') })
  return errors
}

async function onRegisterSubmit(event: FormSubmitEvent<{ name: string, email: string, password: string }>) {
  formError.value = null
  submitting.value = true
  try {
    await register({ name: event.data.name, email: event.data.email, password: event.data.password })
    notify.success('Account created', { description: 'Welcome! Your account has been created.' })
    await handleSuccess()
  } catch (e: unknown) {
    submitting.value = false
    const message = e instanceof Error ? e.message : 'Registration failed'
    formError.value = message
    notify.error('Error', { description: message })
  }
}

// ── Forgot password ───────────────────────────────────────────────────────────

const emailSent = ref(false)
const sentEmail = ref('')

const forgotPasswordFields = computed<AuthFormField[]>(() => [
  { name: 'email', type: 'email', label: t('auth.email'), placeholder: 'you@example.com', required: true }
])

const forgotPasswordSubmitButton = computed(() => ({
  label: t('auth.sendResetLink'),
  loading: submitting.value,
  block: true
}))

async function onForgotPasswordSubmit(event: FormSubmitEvent<{ email: string }>) {
  submitting.value = true
  try {
    await forgotPassword(event.data.email)
    emailSent.value = true
    sentEmail.value = event.data.email
    notify.success('Email sent', { description: 'Check your inbox for a password reset link.' })
  } catch {
    // Don't reveal if email exists — always show success
    emailSent.value = true
    sentEmail.value = event.data.email
    notify.success('Email sent', { description: 'If an account exists with this email, you will receive a reset link.' })
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <UModal
    v-model:open="isOpen"
    :title="modalTitle"
    :dismissible="state.dismissible === true"
    :close="state.dismissible === true"
    :ui="{ overlay: 'z-[60]', content: 'z-[60] sm:max-w-md', title: 'sr-only' }"
  >
    <template #content>
      <div class="p-6">
        <div v-if="showGoHome" class="mb-2 flex justify-end">
          <UButton
            variant="ghost"
            color="neutral"
            size="xs"
            icon="i-lucide-arrow-left"
            @click="handleGoHome"
          >
            Go home
          </UButton>
        </div>
        <Transition
          mode="out-in"
          enter-active-class="transition-all duration-200 ease-out"
          enter-from-class="opacity-0 translate-x-2"
          leave-active-class="transition-all duration-150 ease-in"
          leave-to-class="opacity-0 -translate-x-2"
        >
        <!-- ── Login ──────────────────────────────────────────────────── -->
        <div
          v-if="state.mode === 'login'"
          key="login"
        >
          <!-- Magic link sent -->
          <div
            v-if="magicLinkSent"
            class="space-y-6"
          >
            <div class="text-center">
              <div class="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
                <UIcon
                  name="i-lucide-mail-check"
                  class="h-6 w-6 text-primary"
                />
              </div>
              <h2 class="mt-4 text-xl font-semibold text-highlighted">
                {{ t('auth.checkYourInbox') }}
              </h2>
              <p class="mt-2 text-muted">
                We sent a magic link to <span class="font-medium text-highlighted">{{ magicLinkEmail }}</span>
              </p>
            </div>
            <UButton
              variant="outline"
              color="neutral"
              block
              @click="magicLinkSent = false; showMagicLink = false"
            >
              {{ t('auth.backToSignIn') }}
            </UButton>
          </div>

          <!-- Login form -->
          <template v-else>
            <UAuthForm
              ref="loginForm"
              :fields="loginFields"
              :providers="hasPassword ? oauthButtons : []"
              :submit="loginSubmitButton"
              :disabled="submitting"
              :title="showMagicLink ? t('auth.signInWithMagicLink') : t('auth.welcomeBack')"
              :icon="showMagicLink ? 'i-lucide-wand-2' : 'i-lucide-lock'"
              :separator="hasPassword && oauthButtons.length > 0 ? 'or' : undefined"
              @submit="onLoginSubmit"
            >
              <template #description>
                <template v-if="showMagicLink">
                  {{ t('auth.magicLinkDescription') }}
                </template>
                <template v-else>
                  {{ t('auth.dontHaveAccount') }}
                  <button
                    type="button"
                    class="text-primary font-medium hover:text-primary/80"
                    @click="authModal.setMode('register')"
                  >
                    {{ t('auth.signUp') }}
                  </button>
                </template>
              </template>

              <template
                v-if="!showMagicLink && hasPassword"
                #password-hint
              >
                <button
                  type="button"
                  class="text-primary font-medium hover:text-primary/80"
                  tabindex="-1"
                  @click="authModal.setMode('forgot-password')"
                >
                  {{ t('auth.forgotPassword') }}
                </button>
              </template>

              <template
                v-if="formError"
                #validation
              >
                <UAlert
                  color="error"
                  icon="i-lucide-alert-circle"
                  :title="formError"
                />
              </template>

              <template
                v-if="hasMagicLink && hasPassword"
                #footer
              >
                <button
                  type="button"
                  class="text-sm text-primary font-medium hover:text-primary/80"
                  @click="showMagicLink = !showMagicLink; formError = null"
                >
                  {{ showMagicLink ? t('auth.signInWithPassword') : t('auth.signInWithMagicLink') }}
                </button>
              </template>
            </UAuthForm>

            <!-- OAuth only (no password) -->
            <div
              v-if="!hasPassword && oauthButtons.length > 0"
              class="space-y-6"
            >
              <div class="text-center">
                <div class="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
                  <UIcon
                    name="i-lucide-lock"
                    class="h-6 w-6 text-primary"
                  />
                </div>
                <h2 class="mt-4 text-xl font-semibold text-highlighted">
                  {{ t('auth.welcomeBack') }}
                </h2>
                <p class="mt-2 text-muted">
                  {{ t('auth.dontHaveAccount') }}
                  <button
                    type="button"
                    class="text-primary font-medium hover:text-primary/80"
                    @click="authModal.setMode('register')"
                  >
                    {{ t('auth.signUp') }}
                  </button>
                </p>
              </div>
              <div class="space-y-3">
                <UButton
                  v-for="(provider, i) in oauthButtons"
                  :key="i"
                  v-bind="provider"
                  color="neutral"
                  variant="subtle"
                  block
                />
              </div>
              <UAlert
                v-if="formError"
                color="error"
                icon="i-lucide-alert-circle"
                :title="formError"
              />
            </div>
          </template>
        </div>

        <!-- ── Register ──────────────────────────────────────────────── -->
        <div
          v-else-if="state.mode === 'register'"
          key="register"
        >
          <UAuthForm
            v-if="hasPassword"
            ref="registerForm"
            :fields="registerFields"
            :providers="oauthButtons"
            :submit="registerSubmitButton"
            :validate="validateRegister"
            :disabled="submitting"
            :title="t('auth.createYourAccount')"
            icon="i-lucide-user-plus"
            :separator="oauthButtons.length > 0 ? 'or' : undefined"
            @submit="onRegisterSubmit"
          >
            <template #description>
              {{ t('auth.alreadyHaveAccount') }}
              <button
                type="button"
                class="text-primary font-medium hover:text-primary/80"
                @click="authModal.setMode('login')"
              >
                {{ t('auth.signIn') }}
              </button>
            </template>

            <template
              v-if="formError"
              #validation
            >
              <UAlert
                color="error"
                icon="i-lucide-alert-circle"
                :title="formError"
              />
            </template>

            <template #footer>
              {{ t('auth.termsAgreement') }}
              <ULink
                to="/terms"
                class="text-primary font-medium"
              >
                {{ t('auth.termsOfService') }}
              </ULink>
              {{ t('auth.and') }}
              <ULink
                to="/privacy"
                class="text-primary font-medium"
              >
                {{ t('auth.privacyPolicy') }}
              </ULink>
            </template>
          </UAuthForm>

          <!-- OAuth-only register -->
          <div
            v-else-if="oauthButtons.length > 0"
            class="space-y-6"
          >
            <div class="text-center">
              <div class="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
                <UIcon
                  name="i-lucide-user-plus"
                  class="h-6 w-6 text-primary"
                />
              </div>
              <h2 class="mt-4 text-xl font-semibold text-highlighted">
                {{ t('auth.createYourAccount') }}
              </h2>
              <p class="mt-2 text-muted">
                {{ t('auth.alreadyHaveAccount') }}
                <button
                  type="button"
                  class="text-primary font-medium hover:text-primary/80"
                  @click="authModal.setMode('login')"
                >
                  {{ t('auth.signIn') }}
                </button>
              </p>
            </div>
            <div class="space-y-3">
              <UButton
                v-for="(provider, i) in oauthButtons"
                :key="i"
                v-bind="provider"
                color="neutral"
                variant="subtle"
                block
              />
            </div>
            <UAlert
              v-if="formError"
              color="error"
              icon="i-lucide-alert-circle"
              :title="formError"
            />
          </div>
        </div>

        <!-- ── Forgot password ────────────────────────────────────────── -->
        <div
          v-else-if="state.mode === 'forgot-password'"
          key="forgot"
        >
          <!-- Email sent confirmation -->
          <div
            v-if="emailSent"
            class="space-y-6"
          >
            <div class="text-center">
              <div class="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
                <UIcon
                  name="i-lucide-mail-check"
                  class="h-6 w-6 text-primary"
                />
              </div>
              <h2 class="mt-4 text-xl font-semibold text-highlighted">
                {{ t('auth.checkYourInbox') }}
              </h2>
              <p class="mt-2 text-muted">
                We sent a password reset link to
                <span class="font-medium text-highlighted">{{ sentEmail }}</span>
              </p>
            </div>
            <div class="space-y-3">
              <UButton
                variant="ghost"
                block
                @click="emailSent = false; sentEmail = ''"
              >
                Try another email
              </UButton>
              <UButton
                color="neutral"
                variant="outline"
                block
                @click="authModal.setMode('login')"
              >
                {{ t('auth.backToSignIn') }}
              </UButton>
            </div>
          </div>

          <!-- Forgot password form -->
          <UAuthForm
            v-else
            :fields="forgotPasswordFields"
            :submit="forgotPasswordSubmitButton"
            :disabled="submitting"
            :title="t('auth.resetYourPassword')"
            icon="i-lucide-key-round"
            @submit="onForgotPasswordSubmit"
          >
            <template #description>
              {{ t('auth.resetPasswordDescription') }}
            </template>

            <template #footer>
              <button
                type="button"
                class="text-primary font-medium hover:text-primary/80"
                @click="authModal.setMode('login')"
              >
                {{ t('auth.backToSignIn') }}
              </button>
            </template>
          </UAuthForm>
        </div>
        </Transition>
      </div>
    </template>
  </UModal>
</template>
