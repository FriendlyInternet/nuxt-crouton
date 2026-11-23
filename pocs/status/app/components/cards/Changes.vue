<script setup lang="ts">
// The muted "N files · +A −R · …" line under a PR review card's ask, with the Files-tab link (#4373).
import type { InboxCard } from '~/utils/inbox-core'
import { changeLine } from '~/utils/change-line'

const props = defineProps<{ card: InboxCard }>()
const line = computed(() => changeLine(props.card))
</script>

<template>
  <p v-if="line" class="text-sm text-muted">
    {{ line.text }} · <a :href="line.filesUrl" target="_blank" rel="noopener" class="text-primary">See the code changes</a>
  </p>
</template>
