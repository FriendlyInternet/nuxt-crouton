<script setup lang="ts">
/**
 * PageEditor SeoTab
 *
 * The SEO & social tab body, extracted from Workspace/Editor.vue. Renders the
 * translatable SEO title/description, the AI "Generate description" action
 * (gated on crouton-ai), the og:image picker, robots select, and the search
 * preview. The parent owns form state (translations) and passes the shared
 * editing locale + current page title down; this component reads/writes SEO
 * fields via v-model on a locale-scoped computed the same way Editor.vue did.
 *
 * @example
 * <CroutonPagesEditorSeoTab
 *   v-model:translations="state.translations"
 *   v-model:og-image="state.ogImage"
 *   v-model:robots="state.robots"
 *   :editing-locale="editingLocale"
 *   :current-title="currentTitle"
 *   :has-ai="hasAI"
 *   :team-slug="teamSlugRef"
 * />
 */

interface Props {
  /** Translations map — read/written directly for the SEO fields (locale-scoped). */
  translations: Record<string, Record<string, any>> | undefined
  /** og:image URL/path. */
  ogImage: string | null | undefined
  /** Robots select value. */
  robots: string
  /** Shared editing locale driving which locale's SEO fields are shown. */
  editingLocale: string
  /** Current page title (for the placeholder + og:image picker context). */
  currentTitle: string
  /** Whether crouton-ai is available (gates the Generate button). */
  hasAi: boolean
  /** Team slug for the search preview. */
  teamSlug: string | null | undefined
}

const props = defineProps<Props>()

const emit = defineEmits<{
  'update:translations': [value: Record<string, Record<string, any>>]
  'update:ogImage': [value: string | null]
  'update:robots': [value: string]
}>()

const { t } = useT()

function localeField(field: 'seoTitle' | 'seoDescription') {
  return computed<string>({
    get: () => {
      const tr = props.translations
      return (tr?.[props.editingLocale]?.[field] as string) ?? ''
    },
    set: (val: string) => {
      const tr = { ...(props.translations || {}) }
      tr[props.editingLocale] = { ...(tr[props.editingLocale] || {}), [field]: val }
      emit('update:translations', tr)
    },
  })
}
const seoTitle = localeField('seoTitle')
const seoDescription = localeField('seoDescription')

const robotsOptions = [
  { value: 'index', label: t('pages.robots.index') },
  { value: 'noindex', label: t('pages.robots.noindex') }
]

// Detect optional packages via croutonApps registration
const { hasApp } = useCroutonApps()
const hasAssetsPicker = hasApp('assets')

// Asset ID for the picker (not persisted — just tracks current picker selection)
const selectedOgImageAssetId = ref<string | undefined>()

function handleAssetSelect(asset: Record<string, any>) {
  emit('update:ogImage', `/images/${asset.pathname}`)
  selectedOgImageAssetId.value = asset.id
}

// AI-draft the SEO description from the page's title + content (crouton-ai only).
// Writes into the currently-edited locale's seoDescription.
const seoGenerating = ref(false)
async function generateSeoDescription() {
  seoGenerating.value = true
  try {
    const tr = props.translations as Record<string, { content?: unknown }> | undefined
    const content = tr?.[props.editingLocale]?.content
    const { description } = await $fetch<{ description: string }>('/api/ai/generate-seo', {
      method: 'POST',
      body: {
        title: props.currentTitle,
        content,
        language: props.editingLocale,
      },
    })
    if (description) seoDescription.value = description
  } catch (error) {
    console.error('SEO description generation failed:', error)
    useNotify().error(t('pages.editor.seoGenerateFailed', 'Could not generate a description'))
  } finally {
    seoGenerating.value = false
  }
}
</script>

<template>
  <div class="mx-auto flex w-full max-w-3xl flex-col gap-3 px-4 py-4">
    <!-- SEO title — placeholder is the real page title, so an empty SEO
         title transparently falls back to it. -->
    <UFormField :label="t('pages.fields.seoTitle', 'SEO title')" name="seoTitle">
      <UInput
        v-model="seoTitle"
        size="sm"
        class="w-full"
        :placeholder="currentTitle || t('pages.editor.seoTitlePlaceholder', 'Defaults to the page title')"
      />
    </UFormField>
    <UFormField :label="t('pages.fields.seoDescription', 'SEO description')" name="seoDescription">
      <UTextarea v-model="seoDescription" :rows="3" size="sm" class="w-full" :placeholder="t('pages.editor.seoDescriptionPlaceholder', 'One-line summary for search & shares')" />
      <!-- AI drafts the description from the title + page content (crouton-ai only) -->
      <div v-if="hasAi" class="mt-2 flex justify-end">
        <UButton
          color="primary"
          variant="soft"
          size="xs"
          icon="i-lucide-sparkles"
          :loading="seoGenerating"
          :label="t('pages.editor.seoGenerate', 'Generate with AI')"
          @click="generateSeoDescription"
        />
      </div>
    </UFormField>
    <UFormField :label="t('pages.fields.ogImage')" name="ogImage">
      <Suspense v-if="hasAssetsPicker">
        <CroutonAssetsPicker v-model="selectedOgImageAssetId" @select="handleAssetSelect" />
        <template #fallback>
          <div class="h-20 rounded-lg border-2 border-dashed border-default animate-pulse" />
        </template>
      </Suspense>
      <CroutonImageUpload
        v-else
        :model-value="ogImage ?? undefined"
        size="sm"
        accept="image/*"
        @update:model-value="emit('update:ogImage', $event ?? null)"
      />
    </UFormField>
    <UFormField :label="t('pages.fields.robots')" name="robots">
      <USelect
        :model-value="robots"
        :items="robotsOptions"
        value-key="value"
        size="sm"
        class="w-full"
        @update:model-value="emit('update:robots', $event)"
      />
    </UFormField>
    <CroutonPagesEditorSeoPreview
      :team-slug="teamSlug"
      :translations="translations"
      :og-image="ogImage"
      :preview-locale="editingLocale"
    />
  </div>
</template>
