<template>
  <div class="flex flex-col items-center gap-4 ">
    <template v-if="loading === 'create_open' || loading === 'update_open'">
      <div
        v-for="i in 5"
        :key="i"
        class="flex flex-col gap-2 w-full"
      >
        <USkeleton class="h-6 w-40" />
        <USkeleton class="h-10 w-full" />
      </div>
    </template>

    <template v-if="loading === 'create_send' || loading === 'update_send'">
      {{ t('form.sendingUpdate') }}
    </template>
  </div>
</template>

<script setup lang="ts">
const { loading } = useCrouton()
const { t } = useT()
</script>
