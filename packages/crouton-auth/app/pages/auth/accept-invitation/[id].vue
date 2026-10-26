<script setup lang="ts">
import { localizeError } from '../../../utils/errors'
/**
 * Accept Invitation Page
 *
 * Handles team invitation acceptance when user clicks the invite link in email.
 * URL: /auth/accept-invitation/:id
 *
 * Flow:
 * - Fetches invitation details (team name, inviter, role) without requiring auth
 * - If not logged in: shows invitation info with Register / Sign In options
 * - If logged in: shows invitation info with Accept / Decline buttons
 * - After accepting: redirects to the team dashboard
 */

definePageMeta({
  layout: 'auth'
})

const route = useRoute()
const router = useRouter()
const notify = useNotify()
const { t } = useT()

const { loggedIn } = useAuth()
const { acceptInvitation, rejectInvitation } = useTeam()
const redirects = useAuthRedirects()
const authModal = useAuthModal()

const invitationId = computed(() => route.params.id as string)
const returnUrl = computed(() => route.fullPath)

interface InvitationData {
  status: string
  organizationName: string
  organizationLogo?: string
  inviterName: string
  email: string
  role: string
}

// Fetch invitation details (public endpoint, no auth needed)
const { data: invite, error: fetchError, status } = await useFetch<InvitationData>(
  () => `/api/auth/invitations/${invitationId.value}`
)

// Accept/reject state
const accepting = ref(false)
const accepted = ref(false)
const acceptError = ref<string | null>(null)

// Auto-accept if user just logged in and returned to this page
onMounted(async () => {
  if (loggedIn.value && invite.value?.status === 'pending') {
    await handleAccept()
  }
})

async function handleAccept() {
  accepting.value = true
  acceptError.value = null

  try {
    await acceptInvitation(invitationId.value)
    accepted.value = true
    notify.success(t('teams.invitationAccepted'), {
      description: t('teams.invitationPage.joinedTeam', { team: invite.value?.organizationName ?? '' })
    })

    setTimeout(() => {
      router.push('/')
    }, 1500)
  } catch (e: unknown) {
    const message = e instanceof Error ? localizeError(e, t) : t('teams.failedToAcceptInvitation')
    acceptError.value = message
    notify.error(t('common.error'), { description: message })
  } finally {
    accepting.value = false
  }
}

async function handleReject() {
  try {
    await rejectInvitation(invitationId.value)
    notify.success(t('teams.invitationDeclined'))
    await router.push('/')
  } catch (e: unknown) {
    const message = e instanceof Error ? localizeError(e, t) : t('teams.failedToDeclineInvitation')
    notify.error(t('common.error'), { description: message })
  }
}

function goToRegister() {
  const params = new URLSearchParams({
    redirect: returnUrl.value,
    ...(invite.value?.email && { email: invite.value.email })
  })
  navigateTo(`/auth/register?${params}`)
}

function goToLogin() {
  navigateTo(`/auth/login?redirect=${encodeURIComponent(returnUrl.value)}`)
}
</script>

<template>
  <div>
    <!-- Loading -->
    <div
      v-if="status === 'pending'"
      class="text-center"
    >
      <UIcon
        name="i-lucide-loader-circle"
        class="size-12 animate-spin text-primary"
      />
      <p class="mt-4 text-muted">
        {{ t('teams.invitationPage.loading') }}
      </p>
    </div>

    <!-- Invitation not found -->
    <div
      v-else-if="fetchError"
      class="space-y-6"
    >
      <div class="text-center">
        <UIcon
          name="i-lucide-mail-x"
          class="size-12 text-muted"
        />
        <h1 class="mt-4 text-2xl font-bold text-highlighted">
          {{ t('teams.invitationPage.notFound') }}
        </h1>
        <p class="mt-2 text-muted">
          {{ t('teams.invitationPage.notFoundDescription') }}
        </p>
      </div>
      <NuxtLink
        to="/"
        class="block"
      >
        <UButton
          block
          color="neutral"
          variant="outline"
        >
          {{ t('teams.invitationPage.goToHomepage') }}
        </UButton>
      </NuxtLink>
    </div>

    <!-- Invitation expired or already used -->
    <div
      v-else-if="invite && invite.status !== 'pending'"
      class="space-y-6"
    >
      <div class="text-center">
        <UIcon
          name="i-lucide-clock"
          class="size-12 text-muted"
        />
        <h1 class="mt-4 text-2xl font-bold text-highlighted">
          {{ invite.status === 'expired' ? t('teams.invitationPage.expired') : t('teams.invitationPage.alreadyUsed') }}
        </h1>
        <p class="mt-2 text-muted">
          {{ invite.status === 'expired' ? t('teams.invitationPage.expiredDescription') : t('teams.invitationPage.alreadyUsedDescription') }}
          {{ t('teams.invitationPage.askForNew') }}
        </p>
      </div>
      <NuxtLink
        to="/"
        class="block"
      >
        <UButton
          block
          color="neutral"
          variant="outline"
        >
          {{ t('teams.invitationPage.goToHomepage') }}
        </UButton>
      </NuxtLink>
    </div>

    <!-- Valid invitation -->
    <div
      v-else-if="invite"
      class="space-y-6"
    >
      <!-- Invitation info -->
      <div class="text-center">
        <UAvatar
          v-if="invite.organizationLogo"
          :src="invite.organizationLogo"
          :alt="invite.organizationName"
          size="xl"
        />
        <UIcon
          v-else
          name="i-lucide-building-2"
          class="size-12 text-primary"
        />

        <h1 class="mt-4 text-2xl font-bold text-highlighted">
          {{ t('teams.invitationPage.youreInvited') }}
        </h1>
        <p class="mt-2 text-muted">
          <span class="font-medium text-highlighted">{{ invite.inviterName }}</span>
          {{ t('teams.invitationPage.invitedYouToJoin') }}
        </p>
        <p class="text-lg font-semibold text-highlighted">
          {{ invite.organizationName }}
        </p>
        <UBadge
          color="primary"
          variant="subtle"
          class="mt-2"
        >
          {{ invite.role }}
        </UBadge>
      </div>

      <!-- Accepting state -->
      <div
        v-if="accepting"
        class="text-center"
      >
        <UIcon
          name="i-lucide-loader-circle"
          class="size-8 animate-spin text-primary"
        />
        <p class="mt-2 text-muted">
          {{ t('teams.invitationPage.joining', { team: invite.organizationName }) }}
        </p>
      </div>

      <!-- Accepted -->
      <div v-else-if="accepted">
        <UAlert
          color="success"
          icon="i-lucide-check-circle"
          :title="t('teams.invitationPage.youreIn')"
          :description="t('teams.invitationPage.welcomeRedirecting', { team: invite.organizationName })"
        />
      </div>

      <!-- Error -->
      <div v-else-if="acceptError">
        <UAlert
          color="error"
          icon="i-lucide-alert-triangle"
          :title="t('teams.invitationPage.couldNotAccept')"
          :description="acceptError"
        />
        <UButton
          class="mt-4"
          block
          @click="handleAccept"
        >
          {{ t('auth.magicLink.tryAgain') }}
        </UButton>
      </div>

      <!-- Not logged in — show register/login options -->
      <div
        v-else-if="!loggedIn"
        class="space-y-3"
      >
        <USeparator :label="t('auth.getStarted')" />

        <UButton
          block
          size="lg"
          @click="goToRegister"
        >
          {{ t('teams.invitationPage.createAccount') }}
        </UButton>
        <UButton
          block
          size="lg"
          color="neutral"
          variant="outline"
          @click="goToLogin"
        >
          {{ t('teams.invitationPage.haveAccount') }}
        </UButton>
      </div>

      <!-- Logged in — accept/decline -->
      <div
        v-else
        class="space-y-3"
      >
        <UButton
          block
          size="lg"
          @click="handleAccept"
        >
          {{ t('teams.invitationPage.acceptInvitation') }}
        </UButton>
        <UButton
          block
          size="lg"
          color="neutral"
          variant="ghost"
          @click="handleReject"
        >
          {{ t('teams.decline') }}
        </UButton>
      </div>
    </div>
  </div>
</template>
