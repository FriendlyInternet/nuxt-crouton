<script setup lang="ts">
import type { TocLink } from '../types/content'

const { t } = useT()

interface Props {
  content?: string
  title?: string
  description?: string
  toc?: boolean | TocLink[]
  maxWidth?: 'sm' | 'md' | 'lg' | 'xl' | '2xl' | '3xl' | '4xl' | 'full'
}

const props = withDefaults(defineProps<Props>(), {
  content: '',
  toc: false,
  maxWidth: '3xl'
})

const slots = useSlots()

// Use shared composable for TOC extraction
const { tocLinks: extractedTocLinks } = useContentToc(computed(() => props.content))

// Auto-generate TOC from content if toc is true, or use provided array
const tocLinks = computed<TocLink[]>(() => {
  if (Array.isArray(props.toc)) {
    return props.toc
  }
  if (!props.toc) {
    return []
  }
  return extractedTocLinks.value
})

const hasSidebar = computed(() => !!slots.sidebar || tocLinks.value.length > 0)

const maxWidthClasses: Record<string, string> = {
  'sm': 'max-w-sm',
  'md': 'max-w-md',
  'lg': 'max-w-lg',
  'xl': 'max-w-xl',
  '2xl': 'max-w-2xl',
  '3xl': 'max-w-3xl',
  '4xl': 'max-w-4xl',
  'full': 'max-w-full'
}
</script>

<template>
  <div class="relative">
    <!-- Header slot -->
    <header
      v-if="$slots.header || title"
      class="mb-8"
    >
      <slot name="header">
        <div :class="[maxWidthClasses[maxWidth], 'mx-auto px-4 sm:px-6 lg:px-8']">
          <h1
            v-if="title"
            class="text-3xl sm:text-4xl font-bold tracking-tight"
          >
            {{ title }}
          </h1>
          <p
            v-if="description"
            class="mt-4 text-lg text-muted"
          >
            {{ description }}
          </p>
        </div>
      </slot>
    </header>

    <!-- Main content area -->
    <div :class="[maxWidthClasses[maxWidth], 'mx-auto px-4 sm:px-6 lg:px-8']">
      <div :class="{ 'lg:grid lg:grid-cols-[1fr_220px] lg:gap-8': hasSidebar }">
        <!-- Content -->
        <main class="min-w-0">
          <slot>
            <div
              v-if="content"
              class="prose prose-neutral dark:prose-invert max-w-none prose-headings:scroll-mt-20 prose-a:text-primary prose-a:no-underline hover:prose-a:underline"
              v-html="content"
            />
          </slot>
        </main>

        <!-- Sidebar -->
        <aside
          v-if="hasSidebar"
          class="hidden lg:block"
        >
          <div class="sticky top-20">
            <slot name="sidebar">
              <!-- Default TOC -->
              <nav
                v-if="tocLinks.length > 0"
                class="space-y-1"
              >
                <p class="text-sm font-semibold mb-3">
                  {{ t('content.onThisPage') }}
                </p>
                <ul class="space-y-2 text-sm">
                  <li
                    v-for="link in tocLinks"
                    :key="link.id"
                  >
                    <a
                      :href="`#${link.id}`"
                      :class="[
                        'block text-muted hover:text-foreground transition-colors',
                        link.depth === 3 ? 'pl-4' : ''
                      ]"
                    >
                      {{ link.text }}
                    </a>
                  </li>
                </ul>
              </nav>
            </slot>
          </div>
        </aside>
      </div>
    </div>

    <!-- Footer slot -->
    <footer
      v-if="$slots.footer"
      class="mt-12"
    >
      <div :class="[maxWidthClasses[maxWidth], 'mx-auto px-4 sm:px-6 lg:px-8']">
        <USeparator class="mb-8" />
        <slot name="footer" />
      </div>
    </footer>
  </div>
</template>
