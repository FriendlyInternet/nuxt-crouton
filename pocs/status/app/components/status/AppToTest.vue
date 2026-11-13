<script setup lang="ts">
// One to-test item inside an app card on the Apps tab.
import type { ToTestItem } from '~/utils/status-types'

const props = defineProps<{ item: ToTestItem, app: string }>()

const href = computed(() => loginHrefFor({ ...props.item, app: props.app }))
</script>

<template>
  <div class="space-y-2 rounded-lg border border-default p-3">
    <div class="flex items-start gap-2">
      <h3 class="flex-1 text-sm font-medium">{{ item.title }}</h3>
      <a :href="item.url" target="_blank" rel="noopener" class="text-sm text-primary">#{{ item.number }}</a>
    </div>
    <p v-if="item.what" class="text-sm">{{ item.what }}</p>
    <ol v-if="item.steps.length" class="list-decimal space-y-1 pl-5 text-sm">
      <li v-for="(s, n) in item.steps" :key="n">{{ s }}</li>
    </ol>
    <UButton block icon="i-lucide-log-in" label="Open and sign in" :href="href" target="_blank" />
    <ReplyButtons v-if="item.kind === 'epic'" kind="issue" :number="item.number" />
  </div>
</template>
