<script setup lang="ts">
/**
 * Register Page — Redirect to home and open auth modal.
 *
 * Auth flows now use the RouteModal overlay. Direct URL access
 * (e.g. /auth/register) redirects to "/" and opens the modal there.
 */
definePageMeta({
  middleware: 'guest'
})

const route = useRoute()
const authModal = useAuthModal()

const { t } = useT()
const inviteOnly = useAuthConfig()?.signup === 'invite'

// Invite-only apps: only the accept-invitation redirect (?email=) may register
async function blockIfInviteOnly(): Promise<boolean> {
  if (!inviteOnly || route.query.email) return false
  await navigateTo('/', { replace: true })
  useNotify().info(t('auth.inviteOnly'))
  return true
}

onMounted(async () => {
  if (await blockIfInviteOnly()) return
  const redirectTo = (route.query.redirect as string) || '/'
  const email = (route.query.email as string) || undefined
  await navigateTo('/', { replace: true })
  authModal.open('register', redirectTo, '/', email)
})
</script>

<template>
  <div />
</template>
