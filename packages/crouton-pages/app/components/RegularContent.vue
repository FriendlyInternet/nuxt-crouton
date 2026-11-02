<script setup lang="ts">
/**
 * Regular Page Content Component
 *
 * Renders rich text content from the editor for regular (non-app) pages.
 * Accepts either a page object or direct content string.
 */

interface PageRecord {
  id: string
  title: string
  content?: string | null
}

interface Props {
  page?: PageRecord
  /** Direct content string (takes precedence over page.content) */
  content?: string | null
}

const props = defineProps<Props>()

/** Resolved and sanitized content — props.content takes precedence over page.content */
const resolvedContent = computed(() => {
  const raw = props.content || props.page?.content
  return raw ? sanitizeHtml(raw) : undefined
})
</script>

<template>
  <article class="page-content prose prose-lg dark:prose-invert max-w-none px-4 py-6">
    <div v-if="resolvedContent" v-html="resolvedContent" />
    <div v-else class="text-muted text-center py-12">
      <UIcon name="i-lucide-file-text" class="size-12 mb-4 mx-auto block" />
      <p>{{ $t('pages.noContent') }}</p>
    </div>
  </article>
</template>

<style scoped>
/* Additional prose styling for v-html content */
.page-content :deep(h1) {
  font-size: 1.875rem;
  font-weight: 700;
  margin-bottom: 1rem;
}

.page-content :deep(h2) {
  font-size: 1.5rem;
  font-weight: 600;
  margin-bottom: 0.75rem;
  margin-top: 2rem;
}

.page-content :deep(h3) {
  font-size: 1.25rem;
  font-weight: 600;
  margin-bottom: 0.5rem;
  margin-top: 1.5rem;
}

.page-content :deep(p) {
  margin-bottom: 1rem;
  line-height: 1.625;
}

.page-content :deep(ul),
.page-content :deep(ol) {
  margin-bottom: 1rem;
  padding-left: 1.5rem;
}

.page-content :deep(li) {
  margin-bottom: 0.5rem;
}

.page-content :deep(a) {
  color: var(--ui-primary);
}

.page-content :deep(a:hover) {
  text-decoration: underline;
}

.page-content :deep(blockquote) {
  border-left: 4px solid var(--ui-primary);
  padding-left: 1rem;
  font-style: italic;
  margin: 1rem 0;
}

.page-content :deep(code) {
  background-color: var(--ui-bg-muted);
  padding: 0.125rem 0.375rem;
  border-radius: 0.25rem;
  font-size: 0.875rem;
}

.page-content :deep(pre) {
  background-color: var(--ui-bg-muted);
  padding: 1rem;
  border-radius: 0.5rem;
  overflow-x: auto;
  margin: 1rem 0;
}

.page-content :deep(img) {
  border-radius: 0.5rem;
  margin: 1rem 0;
  max-width: 100%;
  height: auto;
}

/* Highlight mark — themed with Nuxt UI primary color */
.page-content :deep(mark) {
  background-color: color-mix(in srgb, var(--ui-primary) 15%, transparent);
  color: inherit;
  padding: 0.05em 0.3em;
  border-radius: 0.25em;
  border-bottom: 2px solid color-mix(in srgb, var(--ui-primary) 40%, transparent);
  box-decoration-break: clone;
  -webkit-box-decoration-break: clone;
}
</style>
