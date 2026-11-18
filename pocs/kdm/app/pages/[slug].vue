<script setup lang="ts">
// `/<slug>` (and `/<slug>/`) — one segment only, so `/admin/**`, `/auth/**`
// and `/api/**` never reach this page.
definePageMeta({ layout: 'site' })

const route = useRoute()
const slug = String(route.params.slug || '')

const { page, title } = await useSitePage(slug)
</script>

<template>
  <div class="site-prose prose mx-auto mt-12">
    <article>
      <h1 class="mb-20 text-highlighted">
        {{ title }}
      </h1>
      <CroutonPagesRenderer :page="page" locale="en" />
    </article>
  </div>
</template>
