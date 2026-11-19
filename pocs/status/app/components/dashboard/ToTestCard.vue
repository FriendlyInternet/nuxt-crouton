<script setup lang="ts">
// One item on the To test tab: waiting/merged badge, what changed, how to check, sign-in, answer.
import { day } from '~/utils/dashboard'
import type { ToTestItem } from '~/utils/dashboard'

const props = defineProps<{ item: ToTestItem }>()
const isEpic = computed(() => props.item.kind === 'epic')
const href = computed(() => (props.item.app ? loginHrefFor({ ...props.item, app: props.item.app }) : undefined))
</script>

<template>
  <UCard>
    <div class="space-y-3">
      <div class="flex flex-wrap items-center gap-2">
        <UBadge :color="isEpic ? 'warning' : 'success'" variant="subtle">
          {{ isEpic ? 'Waiting for you' : 'Merged' }}
        </UBadge>
        <span v-if="item.mergedAt" class="text-xs text-muted">{{ day(item.mergedAt) }}</span>
        <a :href="item.url" target="_blank" rel="noopener" class="ml-auto text-sm text-primary">#{{ item.number }}</a>
      </div>
      <h3 class="font-medium">{{ item.title }}</h3>
      <div v-if="item.what">
        <p class="text-xs font-semibold uppercase text-muted">What changed</p>
        <p class="text-sm">{{ item.what }}</p>
      </div>
      <div v-if="item.steps.length">
        <p class="text-xs font-semibold uppercase text-muted">How to check</p>
        <ol class="list-decimal space-y-1 pl-5 text-sm">
          <li v-for="(s, n) in item.steps" :key="n">{{ s }}</li>
        </ol>
      </div>
      <UButton
        v-if="href"
        block
        size="lg"
        icon="i-lucide-log-in"
        label="Open and sign in"
        :href="href"
        target="_blank"
      />
      <ReplyButtons v-if="isEpic" kind="issue" :number="item.number" />
    </div>
  </UCard>
</template>
