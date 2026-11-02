<script setup lang="ts">
/**
 * Register Page — Redirect to home and open auth modal.
 *
 * Auth flows now use the RouteModal overlay. Direct URL access
 * (e.g. /auth/register) redirects to "/" and opens the modal there.
 */
import { sanitizeRedirectUrl } from '../../utils/security'

definePageMeta({
  middleware: 'guest'
})

const route = useRoute()
const authModal = useAuthModal()

onMounted(async () => {
  const redirectTo = sanitizeRedirectUrl((route.query.redirect as string) || '/')
  const email = (route.query.email as string) || undefined
  await navigateTo('/', { replace: true })
  authModal.open('register', redirectTo, '/', email)
})
</script>

<template>
  <div />
</template>
