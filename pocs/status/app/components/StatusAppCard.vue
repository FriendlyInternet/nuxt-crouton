<script setup lang="ts">
// One app card (or its collapsed one-line form) on the status page.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
defineProps<{ card: any, v: any }>()
</script>

<template>
    <div v-if="v.collapsed" class="flex items-center gap-3 rounded-lg border border-default p-3">
      <h2 class="flex-1 font-semibold">{{ v.title }}</h2>
      <StagingSignIn :sign-in="v.signIn" :roles="card.hasSignIn && card.app !== 'status'" />
      <a :href="v.lastMergedHref" target="_blank" rel="noopener" class="text-sm text-primary">Last merged</a>
    </div>

    <UCard v-else>
      <template #header>
        <div class="flex items-center gap-2">
          <h2 class="text-lg font-semibold">{{ v.title }}</h2>
          <UBadge v-if="v.count" color="warning" variant="subtle">{{ v.count }} to test</UBadge>
        </div>
      </template>
      <div class="space-y-4">
        <StagingInfo v-if="card.app" :url="card.stagingUrl" :sign-in="v.signIn" :roles="card.hasSignIn && card.app !== 'status'" />

        <ToTestSection v-if="v.count" :previews="v.previews" :items="v.toTest" :roles="card.hasSignIn && card.app !== 'status'" />

        <WaitingList v-if="v.waiting.length" :questions="v.waiting" />

        <DecisionsList v-if="card.decisions.length" :decisions="card.decisions" />
      </div>
      <template #footer>
        <a :href="v.lastMergedHref" target="_blank" rel="noopener" class="text-sm text-primary">Last merged →</a>
      </template>
    </UCard>
</template>
