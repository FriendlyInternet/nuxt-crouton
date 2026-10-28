<script setup lang="ts">
/**
 * Status sign-in — owner only, so no email field: one button mails the link to the
 * configured owner address. Overrides the shared crouton-auth login page for this app.
 */
definePageMeta({
  middleware: 'guest'
})

const route = useRoute()

const loading = ref(false)
const hint = ref<string | null>(null)
const error = ref<string | null>(null)

async function send() {
  loading.value = true
  error.value = null
  try {
    const res = await $fetch<{ sent: boolean, hint: string }>('/api/status/signin-link', {
      method: 'POST',
      body: { redirect: (route.query.redirect as string) || '/' }
    })
    hint.value = res.hint
  } catch (e: any) {
    error.value = e?.statusMessage || e?.data?.statusMessage || 'Could not send the sign-in link.'
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div class="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-4 p-6">
    <h1 class="text-xl font-semibold">
      Crouton Status
    </h1>

    <UAlert
      v-if="hint"
      color="primary"
      icon="i-lucide-mail-check"
      title="Check your inbox"
      :description="`A sign-in link is on its way to ${hint}.`"
    />
    <UAlert
      v-if="error"
      color="error"
      icon="i-lucide-alert-circle"
      :title="error"
    />

    <UButton
      block
      size="xl"
      icon="i-lucide-mail"
      :loading="loading"
      @click="send"
    >
      {{ hint ? 'Send it again' : 'Email me a sign-in link' }}
    </UButton>
  </div>
</template>
