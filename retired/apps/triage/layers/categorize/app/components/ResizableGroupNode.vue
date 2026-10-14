<script setup lang="ts">
import { NodeResizer } from '@vue-flow/node-resizer'
import '@vue-flow/node-resizer/dist/style.css'

interface Props {
  data: {
    label: string
  }
}

defineProps<Props>()
</script>

<template>
  <div class="resizable-group">
    <NodeResizer
      :min-width="250"
      :min-height="120"
      color="transparent"
    />
    <div class="group-label">
      {{ data.label }}
    </div>
    <slot />
  </div>
</template>

<style scoped>
.resizable-group {
  width: 100%;
  height: 100%;
  position: relative;
}

.group-label {
  position: absolute;
  top: 8px;
  left: 12px;
  font-size: 12px;
  font-weight: 600;
  color: #6b7280;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  pointer-events: none;
  z-index: 1;
}
</style>
