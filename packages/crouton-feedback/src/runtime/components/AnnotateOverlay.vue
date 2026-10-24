<script setup lang="ts">
import { ref, watch } from 'vue'
import { useAnnotate } from '../composables/useAnnotate'

/**
 * Annotate overlay — the highlight outline + comment panel for the Annotate
 * tool. Built on Nuxt UI 4 (UTextarea/UButton); the pure capture helpers
 * (overlay/capture.ts) are reused unchanged. Mounted into the host app's context
 * by `plugins/tools/annotate.client.ts`.
 */
const { selecting, hover, panel, sending, toast, closePanel, send } = useAnnotate()

const text = ref('')
watch(panel, (p) => { if (p) text.value = '' })

function onSend(): void {
  if (text.value.trim()) send(text.value)
}
</script>

<template>
  <div data-feedback-overlay>
    <!-- hover / selected highlight -->
    <div
      v-if="(selecting || panel) && hover"
      class="pointer-events-none fixed rounded-sm bg-primary/10 ring-2 ring-primary transition-all duration-75"
      :style="{ left: `${hover.x}px`, top: `${hover.y}px`, width: `${hover.width}px`, height: `${hover.height}px`, zIndex: 2147483640 }"
    />

    <!-- comment panel -->
    <div
      v-if="panel"
      class="fixed w-72"
      :style="{ left: `${panel.left}px`, top: `${panel.top}px`, zIndex: 2147483647 }"
    >
      <div class="rounded-xl bg-default p-3 shadow-xl ring ring-default">
        <p class="mb-2 text-xs text-muted">
          Comment · <code class="break-all text-primary">{{ panel.file }}</code>
        </p>
        <UTextarea
          v-model="text"
          :rows="3"
          autofocus
          autoresize
          placeholder="What should change here?"
          class="w-full"
        />
        <div class="mt-2 flex justify-end gap-2">
          <UButton color="neutral" variant="ghost" size="sm" :disabled="sending" @click="closePanel">
            Cancel
          </UButton>
          <UButton color="primary" size="sm" :loading="sending" @click="onSend">
            Send
          </UButton>
        </div>
      </div>
    </div>

    <!-- toast -->
    <div
      v-if="toast"
      class="fixed bottom-16 left-1/2 -translate-x-1/2 rounded-lg bg-inverted px-3.5 py-2 text-sm text-inverted shadow-lg"
      style="z-index: 2147483647"
    >
      {{ toast }}
    </div>
  </div>
</template>
