<script setup lang="ts">
// Root redirect: send users straight to the sales events page for their team.
// Auth is client-driven (nanostore), so we resolve the team reactively and
// redirect once it's known; signed-out users go to login.
definePageMeta({ layout: false })

const auth = tryUseAuth()
const team = tryUseTeam()
const session = tryUseSession()

function tryUseAuth() {
  try { return useAuth() } catch { return null }
}
function tryUseTeam() {
  try { return useTeam() } catch { return null }
}
function tryUseSession() {
  try { return useSession() } catch { return null }
}

const loggedIn = computed(() => auth?.loggedIn?.value ?? false)
const isPending = computed(() => session?.isPending?.value ?? false)
const teamSlug = computed(() => {
  const t = team?.currentTeam?.value ?? team?.teams?.value?.[0]
  return t?.slug ?? null
})

// The auth modal's after-login refreshTeams() is fire-and-forget and can race
// the session cookie (seen on iOS Safari: teams stay empty → this page used to
// spin forever). Re-fetch here once auth resolves; if the account really has
// no team, say so instead of spinning.
const teamsRefreshed = ref(false)
const refreshingTeams = ref(false)

const noTeam = computed(() =>
  !isPending.value && loggedIn.value && teamsRefreshed.value && !refreshingTeams.value && !teamSlug.value
)

watchEffect(() => {
  // Wait until auth has resolved (avoids a premature login bounce on hydration)
  if (isPending.value) return
  if (!loggedIn.value) {
    navigateTo('/auth/login')
    return
  }
  if (teamSlug.value) {
    navigateTo(`/admin/${teamSlug.value}/sales/events`)
    return
  }
  if (!teamsRefreshed.value && team && import.meta.client) {
    teamsRefreshed.value = true
    refreshingTeams.value = true
    team.refreshTeams().finally(() => { refreshingTeams.value = false })
  }
})

async function signOut() {
  await auth?.logout?.()
  navigateTo('/auth/login')
}
</script>

<template>
  <div class="min-h-screen flex items-center justify-center bg-(--ui-bg)">
    <div v-if="noTeam" class="text-center space-y-3 px-6">
      <UIcon name="i-lucide-users" class="size-8 text-(--ui-text-dimmed)" />
      <p class="text-(--ui-text-muted)">
        Geen team gevonden voor dit account. Vraag een uitnodiging aan je teambeheerder.
      </p>
      <UButton variant="outline" color="neutral" size="sm" @click="signOut">
        Uitloggen
      </UButton>
    </div>
    <UIcon
      v-else
      name="i-lucide-loader-2"
      class="size-6 animate-spin text-(--ui-text-dimmed)"
    />
  </div>
</template>
