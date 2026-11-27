<script setup lang="ts">
// One open PR preview inside an app card on the Apps tab.
import { day } from '~/utils/dashboard'
import { REPO_URL } from '~/utils/package-lines'
import type { AppRow } from '~/utils/dashboard'

defineProps<{ app: string, preview: AppRow['previews'][number] }>()
</script>

<template>
  <div class="space-y-2 rounded-lg border border-default p-3">
    <div class="flex items-start gap-2">
      <span class="flex-1 text-sm">{{ preview.title }}</span>
      <a :href="`${REPO_URL}/pull/${preview.pr}`" target="_blank" rel="noopener" class="text-sm text-primary">#{{ preview.pr }}</a>
    </div>
    <p class="text-xs text-muted">Updated {{ day(preview.updatedAt) }}</p>
    <UButton block variant="outline" icon="i-lucide-log-in" label="Open and sign in" :href="`/api/status/login/${app}?key=pr${preview.pr}`" target="_blank" />
    <ReplyButtons v-if="preview.asksOwner" kind="pr" :number="preview.pr" />
  </div>
</template>
