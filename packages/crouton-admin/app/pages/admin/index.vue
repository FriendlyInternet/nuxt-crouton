<script setup lang="ts">
/**
 * Admin Index Redirect
 *
 * Redirects to the user's first team admin dashboard.
 * Waits for session to be ready, then fetches teams directly from Better Auth API.
 */
definePageMeta({
  middleware: 'auth'
})

const { teams, switchTeamBySlug, canCreateTeam } = useTeam()
const { t } = useT()
const { isPending } = useSession()
const route = useRoute()
const nuxtApp = useNuxtApp()
const requestHeaders = useRequestHeaders(['cookie'])
const hasRedirected = ref(false)

async function fetchAndRedirect() {
  // Prevent multiple redirects and only redirect from exact /admin path
  if (hasRedirected.value || (route.path !== '/admin' && route.path !== '/admin/')) {
    return
  }
  hasRedirected.value = true

  // First check if teams are already loaded in nanostore
  let userTeams: Array<{ id: string; slug: string; name: string }> = teams.value

  // If not, fetch teams from API
  if (userTeams.length === 0) {
    if (import.meta.server) {
      // SSR: authClient is not available, use $fetch with cookies
      try {
        const orgs = await $fetch<Array<{ id: string; slug: string; name: string }>>('/api/auth/organization/list', {
          headers: requestHeaders
        }).catch(() => null)
        if (orgs && orgs.length > 0) {
          userTeams = orgs
        }
      } catch (e) {
        console.error('[@crouton/admin] Failed to fetch teams server-side:', e)
      }
    } else {
      // Client: use Better Auth client
      const authClient = nuxtApp.$authClient as any
      if (authClient?.organization?.list) {
        try {
          const result = await authClient.organization.list()
          if (result.data && result.data.length > 0) {
            userTeams = result.data
          }
        } catch (e) {
          console.error('[@crouton/admin] Failed to fetch teams:', e)
        }
      }
    }
  }

  // Redirect based on teams
  if (userTeams.length > 0) {
    const firstTeam = userTeams[0]
    // Switch active team if needed
    try {
      await switchTeamBySlug(firstTeam!.slug)
    } catch (e) {
      // Ignore switch errors, still redirect
    }
    await nuxtApp.runWithContext(() => navigateTo(`/admin/${firstTeam!.slug}`, { replace: true }))
  } else {
    // No teams - create one only if allowed, otherwise home with a notice
    const target = resolveNoTeamRoute(canCreateTeam.value)
    if (target === '/' && import.meta.client) {
      useToast().add({ title: t('onboarding.noAccessYet'), color: 'warning' })
    }
    await nuxtApp.runWithContext(() => navigateTo(target, { replace: true }))
  }
}

// Wait for session to be ready before checking teams
watch(isPending, async (pending) => {
  if (!pending) {
    await fetchAndRedirect()
  }
}, { immediate: true })
</script>

<template>
  <div
    v-if="route.path === '/admin'"
    class="min-h-screen flex items-center justify-center"
  >
    <UIcon name="i-lucide-loader-2" class="w-8 h-8 animate-spin text-primary" />
  </div>
</template>
