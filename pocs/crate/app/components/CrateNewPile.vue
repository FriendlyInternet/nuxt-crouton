<script setup lang="ts">
import type { CratePile, CrateTrack } from '~/composables/useCrate'

const props = defineProps<{ piles: CratePile[], pathLabel: (p: CratePile) => string, track: CrateTrack | null }>()
const open = defineModel<boolean>('open', { required: true })
const emit = defineEmits<{ create: [name: string, parentId: string | null, fileTrack: boolean] }>()

const name = ref('')
const parentId = ref<string | null>(null)
const fileTrack = ref(true)
const parents = computed(() => [
  { label: 'Top level', value: null },
  ...props.piles.map(p => ({ label: props.pathLabel(p), value: p.id })).sort((a, b) => a.label.localeCompare(b.label))
])

/** Open prefilled — e.g. from a genre word, with a guessed parent. */
function start(prefill: { name?: string, parentId?: string | null } = {}) {
  name.value = prefill.name ?? ''
  parentId.value = prefill.parentId ?? null
  fileTrack.value = true
  open.value = true
}
function submit() {
  if (!name.value.trim()) return
  emit('create', name.value.trim(), parentId.value, fileTrack.value)
  open.value = false
}
defineExpose({ start })
</script>

<template>
  <UModal v-model:open="open" title="New pile">
    <template #body>
      <form class="space-y-4" @submit.prevent="submit">
        <UFormField label="Name">
          <UInput v-model="name" size="xl" class="w-full" autofocus />
        </UFormField>
        <UFormField label="Inside">
          <USelectMenu v-model="parentId" :items="parents" value-key="value" size="xl" class="w-full" />
        </UFormField>
        <UCheckbox v-if="track" v-model="fileTrack" :label="`Put “${track.name}” in it`" />
        <div class="flex justify-end gap-2">
          <UButton color="neutral" variant="ghost" label="Cancel" @click="open = false" />
          <UButton type="submit" label="Create" :disabled="!name.trim()" />
        </div>
      </form>
    </template>
  </UModal>
</template>
