<script setup lang="ts">
// Crate opens straight onto the deck: logged in → your team's crate, else → login.
const { loggedIn } = useAuth()
const { teams } = useTeam()
const { isPending } = useSession()

watchEffect(() => {
  if (isPending.value) return
  if (!loggedIn.value) return navigateTo('/auth/login')
  const team = teams.value[0]
  if (team) navigateTo(`/crate/${team.slug}`, { replace: true })
})
</script>

<template>
  <div class="flex h-dvh items-center justify-center text-muted">
    <span v-if="loggedIn && !isPending && !teams.length">
      No team yet — <ULink to="/onboarding/create-team" class="text-primary">create one</ULink>.
    </span>
    <span v-else>Opening your crate…</span>
  </div>
</template>
