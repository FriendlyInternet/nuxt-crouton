<script setup lang="ts">
definePageMeta({ layout: false })

const route = useRoute()
const redirect = computed(() => {
  const r = String(route.query.redirect ?? '')
  return r.startsWith('/') && !r.startsWith('//') ? r : '/'
})

const loading = ref(false)
const hint = ref('')
const sent = ref(false)
const error = ref('')

async function send() {
  loading.value = true
  error.value = ''
  try {
    const res = await $fetch<{ sent: boolean, hint: string }>('/api/status/signin-link', {
      method: 'POST',
      body: { redirect: redirect.value }
    })
    hint.value = res.hint
    sent.value = true
  } catch (e: any) {
    error.value = e?.data?.statusMessage || e?.statusMessage || 'Could not send the sign-in link.'
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <main class="min-h-screen flex items-center justify-center p-6">
    <div class="w-full max-w-sm space-y-4 text-center">
      <h1 class="text-xl font-semibold">
        Crouton Status
      </h1>
      <p v-if="sent" role="status">
        Link sent to {{ hint }}. Open it on this device.
      </p>
      <UButton
        v-else
        block
        size="xl"
        icon="i-lucide-mail"
        :loading="loading"
        @click="send"
      >
        Email me a sign-in link
      </UButton>
      <p v-if="error" role="alert" class="text-sm text-error">
        {{ error }}
      </p>
    </div>
  </main>
</template>
