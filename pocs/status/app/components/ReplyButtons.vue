<script setup lang="ts">
// "Good to go" / "Not ok" for an epic (issue) or a PR preview — posts the reply via /api/reply.
const props = defineProps<{ kind: 'issue' | 'pr', number: number }>()

const noteOpen = ref(false)
const note = ref('')
const sending = ref<'ok' | 'not-ok' | null>(null)
const sentUrl = ref<string | null>(null)
const error = ref<string | null>(null)

async function send(verdict: 'ok' | 'not-ok') {
  if (sending.value || sentUrl.value) return
  if (verdict === 'not-ok' && !note.value.trim()) {
    error.value = 'Add a short note first.'
    return
  }
  sending.value = verdict
  error.value = null
  try {
    const res = await $fetch<{ data: { url: string } | null, error: string | null }>('/api/reply', {
      method: 'POST',
      body: { kind: props.kind, number: props.number, verdict, note: note.value }
    })
    if (res.error || !res.data) error.value = res.error ?? 'Could not send.'
    else sentUrl.value = res.data.url
  } catch (e: any) {
    error.value = e?.data?.statusMessage ?? e?.statusMessage ?? e?.message ?? 'Could not send.'
  } finally {
    sending.value = null
  }
}
</script>

<template>
  <div class="space-y-2">
    <div v-if="sentUrl" class="flex items-center gap-2 text-sm">
      <UIcon name="i-lucide-check" class="text-success" />
      <span>Sent</span>
      <a :href="sentUrl" target="_blank" rel="noopener" class="text-primary">View comment</a>
    </div>
    <template v-else>
      <div class="grid grid-cols-2 gap-2">
        <UButton
          color="success"
          icon="i-lucide-thumbs-up"
          label="Good to go"
          :loading="sending === 'ok'"
          :disabled="!!sending"
          @click="send('ok')"
        />
        <UButton
          color="error"
          variant="outline"
          icon="i-lucide-thumbs-down"
          label="Not ok"
          :disabled="!!sending"
          @click="noteOpen = !noteOpen"
        />
      </div>
      <div v-if="noteOpen" class="space-y-2">
        <UTextarea v-model="note" class="w-full" :rows="2" placeholder="What is not ok?" aria-label="What is not ok?" />
        <UButton
          block
          color="error"
          label="Send not ok"
          :loading="sending === 'not-ok'"
          :disabled="!!sending"
          @click="send('not-ok')"
        />
      </div>
    </template>
    <UAlert v-if="error" color="error" variant="subtle" icon="i-lucide-triangle-alert" :title="error" />
  </div>
</template>
