<script setup lang="ts">
// "Ask Claude" / "Paste answer" (#2243): research a track from the phone. The question is built
// by the server; the answer is saved as the track's "Agent" tip.
import type { CrateTrack } from '~/composables/useCrate'

const props = defineProps<{ track: CrateTrack }>()
const emit = defineEmits<{ researched: [] }>()

const { getTeamId } = useTeamContext()
const toast = useToast()
const api = (path: string) => `/api/teams/${getTeamId()}/crate${path}`

// Prefetched when the track changes: iOS Safari drops the share sheet if a network call
// is awaited inside the tap, so the tap must call navigator.share straight away.
const { data: question } = useAsyncData(
  () => `crate-research-prompt-${props.track.id}`,
  () => $fetch<{ prompt: string }>(api(`/tracks/${props.track.id}/research-prompt`)),
  { server: false, watch: [() => props.track.id], default: () => null }
)

function ask() {
  const text = question.value?.prompt
  if (!text) return
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text)
      toast.add({ title: 'Question copied — paste it into Claude', icon: 'i-lucide-clipboard-check' })
    } catch {
      toast.add({ title: 'Could not copy the question', color: 'error' })
    }
  }
  if (typeof navigator.share !== 'function') return void copy()
  navigator.share({ text }).catch((e: unknown) => {
    if ((e as { name?: string })?.name !== 'AbortError') copy()
  })
}

const open = ref(false)
const text = ref('')
const error = ref('')
const saving = ref(false)
watch(() => props.track.id, () => { text.value = ''; error.value = '' })

async function save() {
  saving.value = true
  error.value = ''
  try {
    await $fetch(api(`/tracks/${props.track.id}/research-answer`), { method: 'POST', body: { text: text.value } })
    open.value = false
    text.value = ''
    toast.add({ title: 'Saved as research', icon: 'i-lucide-check' })
    emit('researched')
  } catch (e: unknown) {
    const err = e as { statusCode?: number, statusMessage?: string, data?: { message?: string } }
    error.value = err.statusCode === 400 ? (err.data?.message || err.statusMessage || 'Could not read that answer') : 'Could not save — try again'
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <div class="flex items-center gap-1.5">
    <UButton size="xs" color="neutral" variant="ghost" icon="i-lucide-sparkles" label="Ask Claude" :loading="!question" @click="ask" />
    <UButton size="xs" color="neutral" variant="ghost" icon="i-lucide-clipboard-paste" label="Paste answer" @click="open = true" />
    <UModal v-model:open="open" title="Paste Claude's answer" :description="track.name">
      <template #body>
        <form class="space-y-4" @submit.prevent="save">
          <UFormField :error="error || undefined">
            <UTextarea v-model="text" :rows="8" class="w-full" autofocus placeholder="Paste the whole reply here" />
          </UFormField>
          <div class="flex justify-end gap-2">
            <UButton color="neutral" variant="ghost" label="Cancel" @click="open = false" />
            <UButton type="submit" label="Save" :loading="saving" :disabled="!text.trim()" />
          </div>
        </form>
      </template>
    </UModal>
  </div>
</template>
