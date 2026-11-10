<script setup lang="ts">
import { useTimeAgo } from '@vueuse/core'

// Recent changes (#2209): what you did, newest first. Tapping one puts its track on the deck.
interface Change { groupId: string, summary: string, at: number, trackId: string | null, undone: boolean, isUndo: boolean }
const props = defineProps<{ api: (path: string) => string }>()
const emit = defineEmits<{ pick: [trackId: string] }>()
const open = defineModel<boolean>('open', { default: false })

const items = ref<Change[]>([])
const loading = ref(false)
const failed = ref(false)
async function load() {
  loading.value = true
  failed.value = false
  try { items.value = await $fetch<Change[]>(props.api('/changes')) }
  catch { failed.value = true }
  finally { loading.value = false }
}
watch(open, (o) => { if (o) load() })
const ago = (at: number) => useTimeAgo(at).value
function pick(c: Change) {
  if (!c.trackId) return
  emit('pick', c.trackId)
  open.value = false
}
</script>

<template>
  <UDrawer v-model:open="open" title="Recent changes" description="Newest first. Tap one to bring its track back on the deck.">
    <template #body>
      <p v-if="failed" class="py-6 text-center text-error">Couldn’t load changes. <UButton variant="link" label="Retry" @click="load" /></p>
      <p v-else-if="loading && !items.length" class="py-6 text-center text-muted">Loading…</p>
      <p v-else-if="!items.length" class="py-6 text-center text-muted">No changes yet.</p>
      <ul v-else class="max-h-[55dvh] divide-y divide-default/60 overflow-y-auto">
        <li v-for="c in items" :key="c.groupId">
          <UButton block variant="ghost" color="neutral" class="min-w-0 justify-start rounded-none text-left" :disabled="!c.trackId" @click="pick(c)">
            <UIcon :name="c.isUndo ? 'i-lucide-undo-2' : 'i-lucide-history'" class="size-4 shrink-0 text-dimmed" />
            <span class="min-w-0 flex-1 truncate" :class="c.undone && 'text-dimmed line-through'">{{ c.summary }}</span>
            <span class="shrink-0 text-xs text-muted">{{ ago(c.at) }}</span>
          </UButton>
        </li>
      </ul>
    </template>
  </UDrawer>
</template>
