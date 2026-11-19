<script setup lang="ts">
// The ⚠️ "Touches <package>: your Ok approves this." lines under a review card's ask (#3785).
// Tapping one opens a bottom sheet with the plain reason, the approval line and the code-changes link.
import type { InboxCard } from '~/utils/inbox-core'
import { packageLines, type PackageLine } from '~/utils/package-lines'

const props = defineProps<{ card: InboxCard }>()

const lines = computed(() => packageLines(props.card))
const open = ref(false)
const current = ref<PackageLine | null>(null)

function show(line: PackageLine) {
  current.value = line
  open.value = true
}
</script>

<template>
  <div v-if="lines.length" class="space-y-1">
    <UButton
      v-for="line in lines"
      :key="line.name"
      variant="link"
      color="warning"
      class="block w-full whitespace-normal px-0 text-left"
      @click="show(line)"
    >
      ⚠️ Touches <strong>{{ line.name }}</strong>: your Ok approves this.
    </UButton>

    <USlideover v-model:open="open" side="bottom" :title="current ? `Touches ${current.name}` : ''">
      <template #body>
        <div v-if="current" class="space-y-3">
          <p class="whitespace-pre-line text-sm">{{ current.whyText }}</p>
          <p v-if="current.approval" class="text-xs text-muted">{{ current.approval }}</p>
          <a :href="current.filesUrl" target="_blank" rel="noopener" class="block text-sm text-primary">See the code changes</a>
        </div>
      </template>
    </USlideover>
  </div>
</template>
