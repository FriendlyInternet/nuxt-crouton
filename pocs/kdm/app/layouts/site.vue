<script setup lang="ts">
// Kasper's public look (source: pmcp/kdm app/layouts/default.vue): one
// centred column, monospace, full height. No header, footer, menu or logo.
</script>

<template>
  <div class="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 font-mono min-h-screen bg-default text-default">
    <slot />
  </div>
</template>
