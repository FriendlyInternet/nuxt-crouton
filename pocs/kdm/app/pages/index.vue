<script setup lang="ts">
// `/` serves the page whose slug is `home` — asked for explicitly, not the
// endpoint's `_home` mode (that returns the first published root page).
definePageMeta({ layout: 'site' })

const { page, title } = await useSitePage('home')
</script>

<template>
  <div class="site-prose prose mx-auto mt-12">
    <h1 class="text-3xl font-extrabold tracking-tight text-highlighted pb-12">
      {{ title }}
    </h1>
    <div class="w-full mb-40">
      <CroutonPagesRenderer :page="page" locale="en" />
    </div>
  </div>
</template>
