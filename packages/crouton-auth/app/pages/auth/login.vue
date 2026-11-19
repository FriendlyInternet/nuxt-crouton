<script setup lang="ts">
/**
 * Login Page — Redirect to home and open auth modal.
 *
 * Auth flows now use the RouteModal overlay. Direct URL access
 * (e.g. /auth/login) redirects to "/" and opens the modal there.
 */
definePageMeta({
  middleware: 'guest'
})

const route = useRoute()
const authModal = useAuthModal()

// Complexity: linear query reading (redirect, prefill, OAuth resume); page code with no unit coverage inflates CRAP
// fallow-ignore-next-line complexity
onMounted(async () => {
  const redirectTo = (route.query.redirect as string) || '/'
  // Optional credential prefill from the link (e.g. a shared demo/preview URL
  // like /auth/login?email=…&password=…). Fills the fields only — never submits.
  const prefillEmail = (route.query.email as string) || undefined
  const prefillPassword = (route.query.password as string) || undefined
  // An OAuth sign-in for an MCP app (Claude, #4096) arrives as
  // /auth/login?…&sig=…. Keep that signed query in the URL: the auth client
  // sends it with the sign-in request so the server resumes the flow.
  if (route.query.sig) {
    authModal.open('login', redirectTo, route.fullPath, prefillEmail, false, prefillPassword)
    return
  }
  await navigateTo('/', { replace: true })
  authModal.open('login', redirectTo, '/', prefillEmail, false, prefillPassword)
})
</script>

<template>
  <div />
</template>
