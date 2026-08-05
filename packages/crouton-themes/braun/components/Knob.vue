<script setup lang="ts">
// The iconic Braun dial — adapted from the KO knob's drag interaction (#1309).
interface Props {
  modelValue?: number
  min?: number
  max?: number
  size?: 'sm' | 'md' | 'lg'
}

const props = withDefaults(defineProps<Props>(), {
  modelValue: 0,
  min: 0,
  max: 100,
  size: 'md'
})

const emit = defineEmits<{
  'update:modelValue': [value: number]
}>()

const isDragging = ref(false)
const startY = ref(0)
const startValue = ref(0)

const rotation = computed(() => {
  const range = props.max - props.min
  const normalized = (props.modelValue - props.min) / range
  return -135 + (normalized * 270)
})

const sizeClasses = {
  sm: 'w-10 h-10',
  md: 'w-14 h-14',
  lg: 'w-20 h-20'
}

const handleMouseDown = (e: MouseEvent) => {
  isDragging.value = true
  startY.value = e.clientY
  startValue.value = props.modelValue
  window.addEventListener('mousemove', handleMouseMove)
  window.addEventListener('mouseup', handleMouseUp)
}

const handleMouseMove = (e: MouseEvent) => {
  if (!isDragging.value) return
  const deltaY = startY.value - e.clientY
  const range = props.max - props.min
  const sensitivity = range / 100
  const newValue = Math.min(props.max, Math.max(props.min, startValue.value + deltaY * sensitivity))
  emit('update:modelValue', Math.round(newValue))
}

const handleMouseUp = () => {
  isDragging.value = false
  window.removeEventListener('mousemove', handleMouseMove)
  window.removeEventListener('mouseup', handleMouseUp)
}

// Keyboard operation (a11y — the drag interaction alone locks out keyboard
// users): arrows step, Page keys jump, Home/End hit the ends.
const handleKeydown = (e: KeyboardEvent) => {
  const range = props.max - props.min
  const step = Math.max(1, Math.round(range / 100))
  const page = Math.max(step, Math.round(range / 10))
  let next: number | null = null
  switch (e.key) {
    case 'ArrowUp':
    case 'ArrowRight': next = props.modelValue + step; break
    case 'ArrowDown':
    case 'ArrowLeft': next = props.modelValue - step; break
    case 'PageUp': next = props.modelValue + page; break
    case 'PageDown': next = props.modelValue - page; break
    case 'Home': next = props.min; break
    case 'End': next = props.max; break
    default: return
  }
  e.preventDefault()
  emit('update:modelValue', Math.min(props.max, Math.max(props.min, next)))
}
</script>

<template>
  <div
    class="braun-knob"
    :class="sizeClasses[props.size]"
    role="slider"
    tabindex="0"
    :aria-valuemin="props.min"
    :aria-valuemax="props.max"
    :aria-valuenow="props.modelValue"
    @mousedown="handleMouseDown"
    @keydown="handleKeydown"
  >
    <div
      class="braun-knob__dial"
      :style="{ transform: `rotate(${rotation}deg)` }"
    >
      <div class="braun-knob__index" />
    </div>
  </div>
</template>

<style scoped>
.braun-knob {
  position: relative;
  border-radius: 50%;
  cursor: grab;
  user-select: none;
  background: var(--braun-cream-raised);
  border: 1px solid var(--braun-hairline);
  box-shadow: var(--braun-shadow), inset 0 1px 0 #fff;
}

.braun-knob:active {
  cursor: grabbing;
}

.braun-knob:focus-visible {
  outline: 2px solid var(--braun-orange);
  outline-offset: 2px;
}

.braun-knob__dial {
  width: 100%;
  height: 100%;
  position: relative;
  transition: transform 0.05s ease-out;
}

.braun-knob__index {
  position: absolute;
  top: 8%;
  left: 50%;
  transform: translateX(-50%);
  width: 2px;
  height: 26%;
  background-color: var(--braun-orange);
  border-radius: 1px;
}
</style>
