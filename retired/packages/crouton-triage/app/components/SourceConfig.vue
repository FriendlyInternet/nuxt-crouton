<script setup lang="ts">
// @ts-expect-error - layer types resolved at app level
import type { FlowInput } from '#layers/triage/types'

interface Props {
  flowId: string
  teamId: string
  modelValue: boolean
  inputs: FlowInput[]
}

const props = defineProps<Props>()

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  'change': [inputs: FlowInput[]]
}>()

const isOpen = computed({
  get: () => props.modelValue,
  set: (val) => emit('update:modelValue', val),
})

const localInputs = ref<FlowInput[]>([...props.inputs])

watch(() => props.inputs, (val) => {
  localInputs.value = [...val]
}, { deep: true })

function onInputsChange(inputs: FlowInput[]) {
  localInputs.value = inputs
  emit('change', inputs)
}
</script>

<template>
  <CroutonTriageConfigPanel v-model="isOpen" title="Input Sources">
    <CroutonTriageFlowsInputManager
      :flow-id="flowId"
      :team-id="teamId"
      :model-value="localInputs"
      edit-mode
      @update:model-value="onInputsChange"
      @change="onInputsChange"
    />
  </CroutonTriageConfigPanel>
</template>
