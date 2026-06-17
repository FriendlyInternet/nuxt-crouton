<script setup lang="ts">
// Public single-post page — 404s on unknown or draft slugs (API enforces it).
definePageMeta({ layout: false })

const route = useRoute()
const slug = computed(() => String(route.params.slug))

const { data: post, error } = await useFetch(() => `/api/blog/posts/${slug.value}`)

if (error.value || !post.value) {
  throw createError({ statusCode: 404, statusMessage: 'Post not found', fatal: true })
}

useHead(() => ({ title: post.value?.title ?? 'Post' }))

function formatDate(d: string | number | Date | null | undefined) {
  if (!d) return ''
  return new Date(d).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })
}
</script>

<template>
  <div class="min-h-screen bg-(--ui-bg)">
    <div class="max-w-2xl mx-auto px-4 py-10">
      <ULink
        to="/blog"
        class="inline-flex items-center gap-1.5 text-sm text-(--ui-text-muted) hover:text-(--ui-text-highlighted) transition-colors"
      >
        <UIcon name="i-lucide-arrow-left" class="size-4" />
        Back to blog
      </ULink>

      <article v-if="post" class="mt-6">
        <div class="flex items-center gap-2 text-sm text-(--ui-text-muted)">
          <span>{{ formatDate(post.publishedAt) }}</span>
          <span aria-hidden="true">·</span>
          <span>{{ post.author }}</span>
        </div>
        <h1 class="mt-2 text-3xl font-bold tracking-tight text-(--ui-text-highlighted)">
          {{ post.title }}
        </h1>
        <div v-if="post.tags && post.tags.length" class="mt-3 flex flex-wrap gap-1.5">
          <UBadge
            v-for="tag in post.tags"
            :key="tag"
            color="neutral"
            variant="subtle"
            size="sm"
          >
            {{ tag }}
          </UBadge>
        </div>

        <USeparator class="my-6" />

        <!-- body is rich-text HTML authored via CroutonEditorSimple in the admin -->
        <div
          class="prose prose-neutral dark:prose-invert max-w-none text-(--ui-text)"
          v-html="post.body"
        />
      </article>
    </div>
  </div>
</template>
