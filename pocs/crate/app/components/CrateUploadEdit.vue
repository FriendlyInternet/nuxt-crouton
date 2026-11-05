<script setup lang="ts">
// Rename or delete one of your uploads (#2237). Library tracks never open this: rekordbox owns them.
import type { CrateTrack } from '~/composables/useCrate'

const props = defineProps<{ track: CrateTrack | null }>()
const open = defineModel<boolean>('open', { required: true })
const emit = defineEmits<{ save: [artist: string, name: string], delete: [] }>()

const state = reactive({ artist: '', name: '' })
const confirming = ref(false)
watch(open, (isOpen) => {
  if (!isOpen || !props.track) return
  state.artist = props.track.artist ?? ''
  state.name = props.track.name
  confirming.value = false
})
</script>

<template>
  <UModal v-model:open="open" title="Edit upload" :description="track?.name">
    <template #body>
      <UForm :state="state" class="space-y-3" @submit="emit('save', state.artist.trim(), state.name.trim())">
        <UFormField label="Artist" name="artist">
          <UInput v-model="state.artist" class="w-full" autocomplete="off" />
        </UFormField>
        <UFormField label="Title" name="name" required>
          <UInput v-model="state.name" class="w-full" autocomplete="off" />
        </UFormField>
        <div class="flex items-center justify-between gap-2 pt-2">
          <UButton
            v-if="!confirming"
            color="error"
            variant="ghost"
            icon="i-lucide-trash-2"
            label="Delete"
            @click="confirming = true"
          />
          <UButton
            v-else
            color="error"
            icon="i-lucide-trash-2"
            label="Delete for good"
            @click="emit('delete')"
          />
          <UButton type="submit" label="Save" :disabled="!state.name.trim()" />
        </div>
      </UForm>
    </template>
  </UModal>
</template>
