<script setup lang="ts">
// @ts-expect-error - layer types resolved at app level
import type { FlowOutput } from '#layers/triage/types'

interface Props {
  flowId: string
  teamId: string
  availableDomains: string[]
  modelValue: boolean
  outputs: FlowOutput[]
}

const props = defineProps<Props>()

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  'change': [outputs: FlowOutput[]]
}>()

const isOpen = computed({
  get: () => props.modelValue,
  set: (val) => emit('update:modelValue', val),
})

const localOutputs = ref<FlowOutput[]>([...props.outputs])

watch(() => props.outputs, (val) => {
  localOutputs.value = [...val]
}, { deep: true })

function onOutputsChange(outputs: FlowOutput[]) {
  localOutputs.value = outputs
  emit('change', outputs)
}
</script>

<template>
  <CroutonTriageConfigPanel v-model="isOpen" title="Output Destinations">
    <CroutonTriageFlowsOutputManager
      :flow-id="flowId"
      :team-id="teamId"
      :available-domains="availableDomains"
      :model-value="localOutputs"
      edit-mode
      @update:model-value="onOutputsChange"
      @change="onOutputsChange"
    />
  </CroutonTriageConfigPanel>
</template>
