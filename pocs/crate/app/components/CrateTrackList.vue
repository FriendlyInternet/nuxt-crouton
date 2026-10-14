<script setup lang="ts">
import type { CrateTrack, TopTray } from '~/composables/useCrate'

const props = defineProps<{
  title: string
  tray: CrateTrack[]
  /** When set, a search covers all of these instead of just the tray (top level: find filed tracks). */
  searchPool: CrateTrack[] | null
  currentId: string | null
  /** At the top level the tray can switch between the inbox and everything not yet checked. */
  atTop: boolean
}>()
const open = defineModel<boolean>('open', { required: true })
const topTray = defineModel<TopTray>('topTray', { required: true })
const trayModes = [{ label: 'Inbox', value: 'inbox' }, { label: 'To check', value: 'unchecked' }]
const emit = defineEmits<{ pick: [track: CrateTrack] }>()

const search = ref('')
const listed = computed(() => {
  const q = search.value.trim().toLowerCase()
  if (!q) return props.tray.slice(0, 200)
  return (props.searchPool ?? props.tray).filter(t => `${t.artist ?? ''} ${t.name}`.toLowerCase().includes(q)).slice(0, 200)
})
</script>

<template>
  <UDrawer v-model:open="open" :title="title" :description="`${tray.length} tracks`">
    <template #body>
      <div class="space-y-2">
        <UTabs v-if="atTop" v-model="topTray" :items="trayModes" :content="false" size="sm" class="w-full" />
        <UInput v-model="search" icon="i-lucide-search" :placeholder="searchPool ? 'Search all tracks' : 'Search this list'" class="w-full" size="xl" />
        <ul class="max-h-[60dvh] divide-y divide-default overflow-y-auto">
          <li v-for="t in listed" :key="t.id">
            <UButton block variant="ghost" :color="t.id === currentId ? 'primary' : 'neutral'" class="min-w-0 justify-start text-left" @click="emit('pick', t)">
              <span class="min-w-0">
                <span class="block truncate">{{ t.name }}</span>
                <span class="block truncate text-xs text-muted">{{ t.artist }}{{ t.hasAudio ? '' : ' · no audio' }}</span>
              </span>
            </UButton>
          </li>
        </ul>
      </div>
    </template>
  </UDrawer>
</template>
