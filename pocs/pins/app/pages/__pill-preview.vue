<script setup lang="ts">
// Review-only preview of <CroutonUserPill> (#2423). Never ships to a real site.
definePageMeta({ layout: false })

const allowed = import.meta.dev || !!(useRuntimeConfig().public as Record<string, unknown>).croutonReview
if (!allowed) throw createError({ statusCode: 404, statusMessage: 'Not found', fatal: true })

type Identity = 'member' | 'visitor' | 'signedOut'

const authUser = useState<Record<string, unknown> | null>('crouton-auth-user', () => null)
const scopedSession = useState<{ displayName: string } | null>('crouton:scoped-session', () => null)
const { push } = useCroutonStatus()

const identity = ref<Identity>('member')

function setIdentity(next: Identity) {
  identity.value = next
  authUser.value = next === 'member'
    ? { id: 'preview', email: 'maarten@example.com', name: 'Maarten Pol', image: null, emailVerified: true, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }
    : null
  scopedSession.value = next === 'visitor' ? { displayName: 'Lotte' } : null
}
setIdentity('member')

const identities: { key: Identity, label: string }[] = [
  { key: 'member', label: 'Member' },
  { key: 'visitor', label: 'PIN visitor' },
  { key: 'signedOut', label: 'Signed out' }
]

const states = [
  { label: 'Success', color: 'success' as const, run: () => push({ type: 'success', text: 'You saved “Kayak Rental”' }) },
  { label: 'Info', color: 'info' as const, run: () => push({ type: 'info', text: 'Invitation sent', icon: 'i-lucide-info' }) },
  { label: 'Warning', color: 'warning' as const, run: () => push({ type: 'warning', text: 'Check the highlighted fields', icon: 'i-lucide-triangle-alert' }) },
  {
    label: 'Error',
    color: 'error' as const,
    run: () => push({
      type: 'error',
      text: 'Couldn’t save “Center Court”',
      icon: 'i-lucide-circle-alert',
      retry: () => push({ type: 'success', text: 'You saved “Center Court”' })
    })
  }
]
</script>

<template>
  <UApp>
    <div class="min-h-screen bg-default">
      <header class="flex h-16 items-center justify-between gap-3 border-b border-default px-4">
        <span class="truncate font-semibold">Fake header</span>
        <CroutonUserPill placement="inline" />
      </header>

      <main class="mx-auto max-w-xl space-y-6 p-4">
        <section class="space-y-2">
          <h2 class="text-sm font-medium text-muted">Identity (preview only)</h2>
          <div class="flex flex-wrap gap-2">
            <UButton
              v-for="i in identities"
              :key="i.key"
              :label="i.label"
              :variant="identity === i.key ? 'solid' : 'outline'"
              color="neutral"
              @click="setIdentity(i.key)"
            />
          </div>
        </section>

        <section class="space-y-2">
          <h2 class="text-sm font-medium text-muted">Push a status</h2>
          <div class="flex flex-wrap gap-2">
            <UButton
              v-for="s in states"
              :key="s.label"
              :label="s.label"
              :color="s.color"
              variant="soft"
              @click="s.run()"
            />
          </div>
        </section>
      </main>
    </div>
  </UApp>
</template>
