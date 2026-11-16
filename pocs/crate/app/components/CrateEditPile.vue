<script setup lang="ts">
import type { CratePile } from '~/composables/useCrate'

// Edit mode (#2211): rename, reorder, nest or remove one pile. Every action is one undoable step;
// the sheet stays open after a move so a pile can be nudged several places in a row.
const props = defineProps<{
  piles: CratePile[]
  pathLabel: (p: CratePile) => string
  descendants: (p: CratePile) => CratePile[]
  children: (id: string | null) => CratePile[]
  count: (p: CratePile) => number
}>()
const emit = defineEmits<{
  rename: [pile: CratePile, name: string]
  move: [pile: CratePile, parentId: string | null]
  up: [pile: CratePile]
  shift: [pile: CratePile, dir: -1 | 1]
  remove: [pile: CratePile]
}>()

const open = ref(false)
const pileId = ref<string | null>(null)
// Read the pile live, so the sheet shows its new name/place right after each action.
const pile = computed(() => props.piles.find(p => p.id === pileId.value) ?? null)
const name = ref('')
const confirmRemove = ref(false)

const siblings = computed(() => pile.value ? props.children(pile.value.parentId) : [])
const at = computed(() => siblings.value.findIndex(p => p.id === pileId.value))
const targets = computed(() => {
  if (!pile.value) return []
  const blocked = new Set([pile.value.id, ...props.descendants(pile.value).map(p => p.id)])
  return [
    { label: 'Top level', value: null as string | null },
    ...props.piles.filter(p => !blocked.has(p.id)).map(p => ({ label: props.pathLabel(p), value: p.id as string | null })).sort((a, b) => a.label.localeCompare(b.label))
  ]
})
const parentId = computed({
  get: () => pile.value?.parentId ?? null,
  set: (v: string | null) => { if (pile.value && v !== pile.value.parentId) emit('move', pile.value, v) }
})

function start(p: CratePile) {
  pileId.value = p.id
  name.value = p.name
  confirmRemove.value = false
  open.value = true
}
function rename() {
  if (pile.value && name.value.trim() && name.value.trim() !== pile.value.name) emit('rename', pile.value, name.value.trim())
}
function remove() {
  if (!pile.value) return
  if (!confirmRemove.value) {
    confirmRemove.value = true
    return
  }
  emit('remove', pile.value)
  open.value = false
}
// A rename can be refused (name taken) — keep the field in step with the pile's real name.
watch(() => pile.value?.name, (n) => { if (n) name.value = n })
defineExpose({ start })
</script>

<template>
  <UModal v-model:open="open" :title="pile ? `Edit ${pile.name}` : 'Edit pile'" :description="pile ? pathLabel(pile) : undefined">
    <template #body>
      <div v-if="pile" class="space-y-5">
        <form @submit.prevent="rename">
          <UFormField label="Name" :help="`Renames the tag on ${count(pile)} track${count(pile) === 1 ? '' : 's'}`">
            <div class="flex gap-2">
              <UInput v-model="name" size="xl" class="min-w-0 flex-1" />
              <UButton type="submit" label="Rename" size="xl" :disabled="!name.trim() || name.trim() === pile.name" />
            </div>
          </UFormField>
        </form>

        <UFormField label="Inside">
          <USelectMenu v-model="parentId" :items="targets" value-key="value" size="xl" class="w-full" />
        </UFormField>

        <div class="grid grid-cols-2 gap-2">
          <UButton icon="i-lucide-arrow-up" label="Earlier" color="neutral" variant="soft" block :disabled="at <= 0" @click="emit('shift', pile, -1)" />
          <UButton icon="i-lucide-arrow-down" label="Later" color="neutral" variant="soft" block :disabled="at < 0 || at >= siblings.length - 1" @click="emit('shift', pile, 1)" />
          <UButton icon="i-lucide-corner-left-up" label="Up a level" color="neutral" variant="soft" block class="col-span-2" :disabled="!pile.parentId" @click="emit('up', pile)" />
        </div>

        <USeparator />

        <div class="space-y-2">
          <UButton
            :icon="confirmRemove ? 'i-lucide-trash-2' : 'i-lucide-trash'"
            :label="confirmRemove ? `Yes, remove ${pile.name}` : 'Remove pile'"
            color="error"
            :variant="confirmRemove ? 'solid' : 'soft'"
            block
            @click="remove"
          />
          <p class="text-xs text-muted">
            Tracks keep the “{{ pile.name }}” tag<template v-if="children(pile.id).length">, and the piles inside move up into its place</template>.
          </p>
        </div>
      </div>
    </template>
  </UModal>
</template>
