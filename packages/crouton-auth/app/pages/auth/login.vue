<script setup lang="ts">
/**
 * Login Page — Redirect to home and open auth modal.
 *
 * Auth flows now use the RouteModal overlay. Direct URL access
 * (e.g. /auth/login) redirects to "/" and opens the modal there.
 */
import { sanitizeRedirectUrl } from '../../utils/security'

definePageMeta({
  middleware: 'guest'
})

const route = useRoute()
const authModal = useAuthModal()

onMounted(async () => {
  const redirectTo = sanitizeRedirectUrl((route.query.redirect as string) || '/')
  // Optional credential prefill from the link (e.g. a shared demo/preview URL
  // like /auth/login?email=…&password=…). Fills the fields only — never submits.
  const prefillEmail = (route.query.email as string) || undefined
  const prefillPassword = (route.query.password as string) || undefined
  await navigateTo('/', { replace: true })
  authModal.open('login', redirectTo, '/', prefillEmail, false, prefillPassword)
})
</script>

<template>
  <div />
</template>
