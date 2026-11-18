<script setup lang="ts">
import type { NuxtError } from '#app'

// Public error page in the site's plain look — no dashboard links, no team
// name, no crouton chrome (#4153).
const props = defineProps<{ error: NuxtError }>()

const status = computed(() => props.error?.statusCode || 500)
const heading = computed(() => {
  if (status.value === 404) return 'Page not found'
  if (status.value === 401 || status.value === 403) return 'This page is not available'
  return 'Something went wrong'
})

useHead({ title: heading, titleTemplate: '%s' })
</script>

<template>
  <UApp>
    <div class="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 font-mono min-h-screen bg-default text-default">
      <div class="site-prose prose mx-auto mt-12">
        <h1 class="mb-20 text-highlighted">
          {{ heading }}
        </h1>
        <p class="text-muted">
          {{ status }}
        </p>
        <p>
          <ULink to="/" class="underline" @click.prevent="clearError({ redirect: '/' })">
            ← Home
          </ULink>
        </p>
      </div>
    </div>
  </UApp>
</template>
