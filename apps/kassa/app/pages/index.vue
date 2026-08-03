<script setup lang="ts">
// Root dispatcher: send users straight to the sales events page for their team.
//
// The redirect lives in ROUTE MIDDLEWARE, not a watchEffect (#1703). A
// watchEffect re-runs on every reactive change and re-issues navigateTo, which
// cancels its own in-flight navigation — and since the team middleware calls
// setActive (which used to re-emit better-auth's $sessionSignal), each redirect
// attempt retriggered the effect that started it. The router never settled and
// the page sat on its spinner until a manual reload.
//
// Route middleware runs once per navigation, on the server as well as the
// client, can await its data, and returns a single navigateTo. It cannot
// restart itself.
definePageMeta({
  layout: false,
  middleware: [
    async () => {
      const { loggedIn } = useAuth()
      if (!loggedIn.value) return navigateTo('/auth/login')

      const slug = await resolveTeamSlug(useTeam())
      // No slug: fall through and render the team-less message. Never spin.
      if (!slug) return

      return navigateTo(`/admin/${slug}/sales/events`, { replace: true })
    }
  ]
})

/**
 * The team this account should land in.
 *
 * On a cold load `team-context.global.ts` (a global middleware, so it always
 * runs first) has already populated the team list during SSR, so the refresh
 * below rarely fires. It matters after a client-side login, where nothing has
 * fetched yet.
 */
async function resolveTeamSlug(team: ReturnType<typeof useTeam>): Promise<string | null> {
  const pick = () => {
    const active = team.currentTeam.value ?? team.teams.value[0]
    return active?.slug ?? null
  }

  const known = pick()
  if (known || import.meta.server) return known

  await team.refreshTeams().catch(() => {})
  return pick()
}

const { logout } = useAuth()

async function signOut() {
  await logout()
  navigateTo('/auth/login')
}
</script>

<template>
  <!--
    Reaching this template means the middleware ran and found no team — the
    account genuinely belongs to none. That is a terminal, actionable state, not
    a loading state, so there is deliberately no spinner here: if this page
    renders at all, waiting cannot help.
  -->
  <div class="min-h-screen flex items-center justify-center bg-(--ui-bg)">
    <div class="text-center space-y-3 px-6">
      <UIcon name="i-lucide-users" class="size-8 text-(--ui-text-dimmed)" />
      <p class="text-(--ui-text-muted)">
        Geen team gevonden voor dit account. Vraag een uitnodiging aan je teambeheerder.
      </p>
      <UButton variant="outline" color="neutral" size="sm" @click="signOut">
        Uitloggen
      </UButton>
    </div>
  </div>
</template>
