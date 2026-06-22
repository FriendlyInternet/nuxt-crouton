<script setup lang="ts">
// Bare /admin landing. The `auth` middleware (from @fyit/crouton-auth) gates this
// route: unauthenticated users are redirected to /auth/login?redirect=/admin.
// Authenticated users are forwarded to their team's links collection.
definePageMeta({
  middleware: 'auth',
  layout: false
})

const team = tryUseTeam()
const session = tryUseSession()

function tryUseTeam() {
  try { return useTeam() } catch { return null }
}
function tryUseSession() {
  try { return useSession() } catch { return null }
}

const isPending = computed(() => session?.isPending?.value ?? false)
const teamSlug = computed(() => {
  const current = team?.currentTeam?.value ?? team?.teams?.value?.[0]
  return current?.slug ?? null
})

watchEffect(() => {
  // Wait until the team resolves before forwarding into /admin/[team]/*.
  if (isPending.value) return
  if (teamSlug.value) {
    navigateTo(`/admin/${teamSlug.value}/links`)
  }
})
</script>

<template>
  <div class="min-h-screen flex flex-col items-center justify-center gap-3 bg-(--ui-bg)">
    <UIcon
      name="i-lucide-loader-2"
      class="size-6 animate-spin text-(--ui-primary)"
    />
    <p class="text-sm text-(--ui-text-muted)">
      Loading your workspace...
    </p>
  </div>
</template>
