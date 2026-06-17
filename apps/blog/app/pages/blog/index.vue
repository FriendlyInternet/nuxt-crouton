<script setup lang="ts">
// Public blog index — no admin chrome, no auth required.
definePageMeta({ layout: false })

const { data: posts, pending, error } = await useFetch('/api/blog/posts')

useHead({ title: 'Blog' })

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
    <header class="border-b border-(--ui-border)">
      <div class="max-w-3xl mx-auto px-4 py-10">
        <h1 class="text-3xl font-bold tracking-tight text-(--ui-text-highlighted)">
          Blog
        </h1>
        <p class="mt-1 text-(--ui-text-muted)">Latest posts</p>
      </div>
    </header>

    <main class="max-w-3xl mx-auto px-4 py-8">
      <div v-if="pending" class="flex justify-center py-16">
        <UIcon name="i-lucide-loader-2" class="size-6 animate-spin text-(--ui-text-dimmed)" />
      </div>

      <UAlert
        v-else-if="error"
        color="error"
        variant="subtle"
        title="Failed to load posts"
        icon="i-lucide-triangle-alert"
      />

      <div v-else-if="!posts || posts.length === 0" class="text-center py-16">
        <UIcon name="i-lucide-newspaper" class="size-10 mx-auto text-(--ui-text-dimmed)" />
        <p class="mt-3 text-(--ui-text-muted)">No posts published yet.</p>
      </div>

      <ul v-else class="space-y-4">
        <li v-for="post in posts" :key="post.id">
          <ULink :to="`/blog/${post.slug}`" class="block group">
            <UCard
              class="transition-all duration-200 hover:shadow-md hover:border-(--ui-border-accented)"
            >
              <div class="flex items-center gap-2 text-xs text-(--ui-text-muted)">
                <span>{{ formatDate(post.publishedAt) }}</span>
                <span aria-hidden="true">·</span>
                <span>{{ post.author }}</span>
              </div>
              <h2
                class="mt-1 text-xl font-semibold text-(--ui-text-highlighted) group-hover:text-(--ui-primary) transition-colors"
              >
                {{ post.title }}
              </h2>
              <p v-if="post.excerpt" class="mt-2 text-(--ui-text-muted) line-clamp-2">
                {{ post.excerpt }}
              </p>
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
            </UCard>
          </ULink>
        </li>
      </ul>
    </main>
  </div>
</template>
