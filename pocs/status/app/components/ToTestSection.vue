<script setup lang="ts">
// The "To test" block of a card: open previews, then epics awaiting a test.
defineProps<{
  previews: Array<{ pr: number, title: string, updatedAt: string, signIn?: string | null }>
  items: Array<{ kind: string, number: number, title: string, url: string, what: string, steps: string[], signIn?: string | null }>
  roles?: boolean
}>()

const REPO_URL = 'https://github.com/FriendlyInternet/nuxt-crouton'
const day = (iso?: string | null) => (iso ? iso.slice(0, 10) : '')
</script>

<template>
  <div class="space-y-3">
    <p class="text-xs font-semibold uppercase text-muted">To test</p>
    <div v-for="p in previews" :key="`pr-${p.pr}`" class="space-y-2 rounded-lg border border-default p-3">
      <div class="flex items-start gap-2">
        <span class="flex-1 text-sm font-medium">{{ p.title }}</span>
        <a :href="`${REPO_URL}/pull/${p.pr}`" target="_blank" rel="noopener" class="text-sm text-primary">#{{ p.pr }}</a>
      </div>
      <p class="text-xs text-muted">Updated {{ day(p.updatedAt) }}</p>
      <StagingSignIn :sign-in="p.signIn" :roles="roles" variant="outline" />
      <ReplyButtons kind="pr" :number="p.pr" />
    </div>
    <div v-for="i in items" :key="`${i.kind}-${i.number}`" class="space-y-2 rounded-lg border border-default p-3">
      <div class="flex items-start gap-2">
        <h3 class="flex-1 text-sm font-medium">{{ i.title }}</h3>
        <a :href="i.url" target="_blank" rel="noopener" class="text-sm text-primary">#{{ i.number }}</a>
      </div>
      <p v-if="i.what" class="text-sm">{{ i.what }}</p>
      <ol v-if="i.steps.length" class="list-decimal space-y-1 pl-5 text-sm">
        <li v-for="(s, n) in i.steps" :key="n">{{ s }}</li>
      </ol>
      <UButton v-if="i.signIn" block icon="i-lucide-log-in" label="Open and sign in" :href="i.signIn" target="_blank" />
      <ReplyButtons v-if="i.kind === 'epic'" kind="issue" :number="i.number" />
    </div>
  </div>
</template>
