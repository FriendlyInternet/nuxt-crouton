<!--
  Collection item pages (e.g. bookings:bookingsLocations-detail): pick the item the page is
  about, stored in `config.itemId`, and fill the page's title/slug/SEO/og-image from it once
  (only fields still empty). Part of the Content tab (#2324).
-->
<script setup lang="ts">
const props = defineProps<{
  /** The page type's display name (an i18n key or a plain string). */
  typeName?: string
  /** The collection the page type is bound to. */
  collectionName: string
}>()
const config = defineModel<Record<string, any> | null>('config', { default: () => ({}) })
const translations = defineModel<Record<string, any> | null>('translations', { default: () => ({}) })
const ogImage = defineModel<string>('ogImage', { default: '' })

const { t } = useT()
const { locale } = useI18n()
const collections = useCollections()
const { getTeamId } = useTeamContext()

const typeLabel = computed(() => (props.typeName ? t(props.typeName, props.typeName) : undefined))
const itemId = computed<string | null>({
  get: () => (config.value as any)?.itemId || null,
  set: (val) => { config.value = { ...config.value, itemId: val } },
})
const labelKey = computed(() => collections.getConfig(props.collectionName)?.display?.title || 'title')

// watch + $fetch rather than useFetch: a null URL would be fetched as a relative "null".
const selectedItem = ref<Record<string, any> | null>(null)
watch([itemId, () => props.collectionName], async ([id, colName]) => {
  const cfg = id ? collections.getConfig(colName) : null
  const teamId = getTeamId()
  if (!cfg?.apiPath || !teamId) { selectedItem.value = null; return }
  try {
    const response = await $fetch<any>(`/api/teams/${teamId}/${cfg.apiPath}`, { query: { ids: id }, credentials: 'include' })
    const items = response?.items || response
    selectedItem.value = Array.isArray(items) ? (items[0] || null) : items
  } catch {
    selectedItem.value = null
  }
})

/** The item's display title: the configured title field, its translation, or the usual fallbacks. */
function pickItemTitle(item: Record<string, any>, titleField: string, loc: string): string | undefined {
  const tr = item.translations as Record<string, Record<string, string>> | undefined
  return item[titleField] || tr?.[loc]?.[titleField] || tr?.en?.[titleField] || item.name || item.title
}

/** Fill title/slug/SEO for the current locale from the picked item — only when the title is still empty. */
function autofillTranslations(item: Record<string, any>, title: string, descriptionField: string | undefined, loc: string): void {
  const next = { ...(translations.value as Record<string, Record<string, string>> | null ?? {}) }
  next[loc] = { ...(next[loc] ?? {}) }
  if (next[loc].title) return
  next[loc].title = title
  next[loc].slug = slugify(title)
  next[loc].seoTitle = title
  const description = descriptionField ? item[descriptionField] : undefined
  if (description) next[loc].seoDescription = String(description).slice(0, 160)
  translations.value = next
}

watch(selectedItem, (item) => {
  if (!item) return
  const display = collections.getConfig(props.collectionName)?.display
  const loc = locale.value || 'en'
  const title = pickItemTitle(item, display?.title || 'title', loc)
  if (!title) return
  autofillTranslations(item, title, display?.description, loc)
  const image = display?.image ? item[display.image] : undefined
  if (image && !ogImage.value) ogImage.value = image
})
</script>

<template>
  <div class="px-4 pt-4 pb-2 shrink-0 border-b border-default">
    <UFormField :label="t('pages.editor.selectItem', { name: typeLabel ?? t('pages.editor.item') })" name="config.itemId">
      <CroutonFormReferenceSelect
        v-model="itemId"
        :collection="collectionName"
        :label="typeLabel"
        :label-key="labelKey"
      />
    </UFormField>
  </div>
</template>
