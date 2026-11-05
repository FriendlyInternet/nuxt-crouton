<!--
  The editor's preview drawer (#2325, slice 4 of #1640): renders the page as the public
  site would, for any locale that has content. The editor hands it the assembled preview
  page and the locale being edited; everything else is this component's own.
-->
<script setup lang="ts">
/** The shape CroutonPagesRenderer takes (its PageRecord), as the editor assembles it. */
interface PreviewPage {
  id: string
  teamId: string
  title: string
  slug: string
  pageType: string
  content?: string | null
  config?: Record<string, unknown> | null
  status: string
  visibility: string
  showInNavigation: boolean
  parentId?: string | null
  order: number
  translations?: Record<string, { title?: string, slug?: string, content?: string }>
}

const props = defineProps<{
  page: PreviewPage
  /** The editor's active locale — the preview opens on it. */
  initialLocale: string
}>()
const open = defineModel<boolean>('open', { default: false })

const { t } = useT()
const previewLocale = ref(props.initialLocale)
watch(open, (isOpen) => {
  if (isOpen) previewLocale.value = props.initialLocale
})

/** Locales that actually have content (for the language selector). */
const availableLocales = computed(() => {
  const translations = props.page.translations
  if (!translations) return [props.initialLocale]
  return Object.entries(translations)
    .filter(([, data]) => data?.title || data?.content)
    .map(([loc]) => loc)
})
const isDraft = computed(() => props.page.status === 'draft')
</script>

<template>
  <USlideover v-model:open="open" :ui="{ content: 'w-full sm:max-w-2xl lg:max-w-4xl' }">
    <template #content="{ close }">
      <div class="flex flex-col h-full">
        <!-- Header -->
        <div class="flex items-center justify-between px-4 py-3 border-b border-default">
          <div class="flex items-center gap-2">
            <UIcon name="i-lucide-eye" class="size-4 text-muted" />
            <span class="text-sm font-medium">
              {{ isDraft ? t('pages.editor.draftPreview') : t('pages.editor.pagePreview') }}
            </span>
            <UBadge v-if="isDraft" color="warning" variant="subtle" size="xs">
              {{ t('pages.status.draft') }}
            </UBadge>
          </div>

          <div class="flex items-center gap-2">
            <!-- Language selector (shown when multiple locales have content) -->
            <div v-if="availableLocales.length > 1" class="flex items-center gap-1">
              <UButton
                v-for="loc in availableLocales"
                :key="loc"
                size="xs"
                :color="previewLocale === loc ? 'primary' : 'neutral'"
                :variant="previewLocale === loc ? 'soft' : 'ghost'"
                class="uppercase font-mono"
                @click="previewLocale = loc"
              >
                {{ loc }}
              </UButton>
            </div>

            <UButton variant="ghost" color="neutral" icon="i-lucide-x" size="xs" :aria-label="t('common.close')" @click="close" />
          </div>
        </div>

        <!-- Rendered page content -->
        <div class="flex-1 overflow-auto">
          <div class="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
            <CroutonPagesRenderer :page="page" :locale="previewLocale" />
          </div>
        </div>
      </div>
    </template>
  </USlideover>
</template>
