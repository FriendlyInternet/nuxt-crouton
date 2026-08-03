<script setup lang="ts">
/**
 * Paste-import products (#1657, epic #1652).
 *
 * Paste a spreadsheet → live client-side preview (the pure #1655 parser, no network)
 * → confirm → one POST to the #1656 endpoint. Nothing is written until Import is
 * pressed, and the server re-parses the raw text anyway, so this preview is an
 * honest rehearsal rather than the authority.
 */
import {
  parseProductPaste,
  type ImportableField,
  type ParseResult,
  type ParsedProductRow,
} from '../../utils/parse-product-paste'

const props = defineProps<{
  eventId: string
  /** Defaults to the route's `[team]` param — present on admin and CMS routes alike. */
  teamParam?: string
}>()

const open = defineModel<boolean>('open', { default: false })

const { t } = useT()
const route = useRoute()
const notify = useNotify()
const nuxtApp = useNuxtApp()

const teamId = computed(() => props.teamParam ?? String(route.params.team ?? ''))
const eventQuery = computed(() => ({ eventId: props.eventId }))

const { items: products, refresh: refreshProducts } = await useCollectionQuery('salesProducts', { query: eventQuery })
const { items: categories, refresh: refreshCategories } = await useCollectionQuery('salesCategories', { query: eventQuery })
const { items: locations, refresh: refreshLocations } = await useCollectionQuery('salesLocations', { query: eventQuery })

const titlesOf = (rows: unknown) => ((rows as { title?: string }[] | null) ?? [])
  .map(r => r.title ?? '').filter(Boolean)

const paste = ref('')
const submitting = ref(false)
/** Per-column overrides the user picked; index → field or 'ignore'. */
const overrides = ref<Record<number, ImportableField | 'ignore'>>({})
/** Duplicate rows the user force-created, by 1-based rowIndex. */
const forced = ref<Set<number>>(new Set())

/** Every field the paste can map onto, plus an explicit "don't import this column". */
const FIELD_OPTIONS = computed(() => ([
  { value: 'ignore', label: t('sales.import.fieldIgnore', 'Ignore') },
  { value: 'title', label: t('sales.import.fieldTitle', 'Product name') },
  { value: 'price', label: t('sales.import.fieldPrice', 'Price') },
  { value: 'categoryTitle', label: t('sales.import.fieldCategory', 'Category') },
  { value: 'locationTitle', label: t('sales.import.fieldLocation', 'Location') },
  { value: 'description', label: t('sales.import.fieldDescription', 'Description') },
  { value: 'isActive', label: t('sales.import.fieldActive', 'Active') },
  { value: 'requiresRemark', label: t('sales.import.fieldRequiresRemark', 'Requires remark') },
  { value: 'remarkPrompt', label: t('sales.import.fieldRemarkPrompt', 'Remark prompt') },
]))

/**
 * Re-parse on every keystroke/remap. The parser is pure and sub-millisecond on a
 * realistic list, so there is nothing to debounce.
 */
const parsed = computed<ParseResult | null>(() => {
  if (!paste.value.trim()) return null
  const result = parseProductPaste(paste.value, {
    existingProductTitles: titlesOf(products.value),
    existingCategoryTitles: titlesOf(categories.value),
    existingLocationTitles: titlesOf(locations.value),
  })
  // Apply the user's column corrections, then re-run so every row reflects them.
  const changed = Object.keys(overrides.value).length > 0
  if (!changed) return result
  const headers = result.headers.map((h, i) => {
    const o = overrides.value[i]
    return o === undefined ? h : { ...h, field: o === 'ignore' ? null : o }
  })
  return reparseWith(headers, result)
})

/**
 * Rebuild the paste with the corrected header row so the pure parser — the single
 * source of truth for the parse contract — produces the corrected rows too, rather
 * than us re-implementing row reading here.
 */
function reparseWith(headers: ParseResult['headers'], original: ParseResult): ParseResult {
  const CANONICAL: Record<ImportableField, string> = {
    title: 'Name',
    price: 'Price',
    categoryTitle: 'Category',
    locationTitle: 'Location',
    description: 'Description',
    isActive: 'Active',
    requiresRemark: 'Requires Remark',
    remarkPrompt: 'Remark Prompt',
  }
  const sep = original.delimiter === 'tab' ? '\t' : original.delimiter === 'semicolon' ? ';' : ','
  const lines = paste.value.split(/\r?\n/).filter(l => l.trim() !== '')
  const headerLine = headers.map(h => (h.field ? CANONICAL[h.field] : '~ignored~')).join(sep)
  const rebuilt = [headerLine, ...lines.slice(1)].join('\n')
  const result = parseProductPaste(rebuilt, {
    existingProductTitles: titlesOf(products.value),
    existingCategoryTitles: titlesOf(categories.value),
    existingLocationTitles: titlesOf(locations.value),
  })
  // Keep the user's original header labels on screen — only the mapping changed.
  return { ...result, headers: headers.map((h, i) => ({ ...h, name: original.headers[i]?.name ?? h.name })) }
}

const rows = computed<ParsedProductRow[]>(() => parsed.value?.rows ?? [])
const relations = computed(() => parsed.value?.relationsToCreate ?? [])

const counts = computed(() => ({
  new: rows.value.filter(r => r.status === 'new').length,
  duplicate: rows.value.filter(r => r.status === 'warn-duplicate').length,
  error: rows.value.filter(r => r.status === 'error').length,
}))

/** New rows plus any duplicate the user explicitly ticked. */
const importableCount = computed(() =>
  counts.value.new + rows.value.filter(r => r.status === 'warn-duplicate' && forced.value.has(r.rowIndex)).length)

/** Which field a column is currently mapped to — the user's override, else the parser's guess. */
const fieldFor = (i: number, header: { field: ImportableField | null }) =>
  overrides.value[i] ?? header.field ?? 'ignore'

/** A column with a blank header still needs something to point at in the UI. */
const labelFor = (header: { name: string }, i: number) => header.name || `#${i + 1}`

function toggleForced(rowIndex: number) {
  const next = new Set(forced.value)
  if (next.has(rowIndex)) next.delete(rowIndex)
  else next.add(rowIndex)
  forced.value = next
}

function reset() {
  paste.value = ''
  overrides.value = {}
  forced.value = new Set()
}

interface ImportResult {
  created: number
  skipped: number
  errors: { rowIndex: number, message: string }[]
  createdCategories: string[]
  createdLocations: string[]
}

const summaryOf = (r: ImportResult) =>
  t('sales.import.doneBody', '{created} created, {skipped} skipped, {errors} failed')
    .replace('{created}', String(r.created))
    .replace('{skipped}', String(r.skipped))
    .replace('{errors}', String(r.errors.length))

/**
 * Surface the server's own reason when it gave one — "nothing was saved" alone leaves
 * the user guessing whether to retry or fix the paste.
 */
function reasonOf(e: unknown): string {
  const err = (e ?? {}) as { statusMessage?: string, message?: string }
  return err.statusMessage ?? err.message ?? t('sales.import.failedBody', 'Nothing was saved.')
}

/**
 * The import POST bypasses useCollectionMutation, so we emit the mutation hook
 * ourselves — the kassa and any other open product surface refresh live instead of
 * only on remount (same pattern as usePosOrder's checkout).
 */
async function announce(result: ImportResult) {
  await Promise.all([refreshProducts(), refreshCategories(), refreshLocations()])
  await nuxtApp.hooks.callHook('crouton:mutation', {
    operation: 'create',
    collection: 'salesProducts',
    data: { eventId: props.eventId },
    result,
    correlationId: `product-import-${props.eventId}`,
    timestamp: Date.now(),
  })
}

async function submit() {
  if (!importableCount.value || submitting.value) return
  submitting.value = true
  try {
    const result = await $fetch<ImportResult>(
      `/api/crouton-sales/teams/${teamId.value}/events/${props.eventId}/products/import`,
      { method: 'POST', body: { paste: paste.value, createDuplicateRowIndexes: [...forced.value] } },
    )
    await announce(result)
    notify.success(summaryOf(result))
    reset()
    open.value = false
  }
  catch (e) {
    notify.error(`${t('sales.import.failedTitle', 'Import failed')} — ${reasonOf(e)}`)
  }
  finally {
    submitting.value = false
  }
}
</script>

<template>
  <!-- `#body`/`#footer` rather than `#content`: that lets UModal render its own header
       from `title`/`description`, which is what names the dialog for a screen reader —
       `#content` replaces the header wholesale, so those props would render nothing and
       the dialog would go unnamed. It also drops our hand-rolled header/footer chrome. -->
  <UModal
    v-model:open="open"
    :title="t('sales.import.title', 'Import products')"
    :description="t('sales.import.subtitle', 'Paste rows from a spreadsheet. Nothing is saved until you press Import.')"
    :ui="{ content: 'max-w-4xl' }"
  >
    <template #body>
      <div class="space-y-4">
        <UFormField
          :label="t('sales.import.pasteLabel', 'Pasted rows')"
          :description="t('sales.import.pasteHint', 'Include the header row (Name, Price, Category, Location).')"
        >
          <UTextarea
            v-model="paste"
            :rows="6"
            class="w-full font-mono text-xs"
            :placeholder="'Name\tPrice\tCategory\tLocation\nPils\t3\tDrank\tBar'"
            autoresize
            :maxrows="12"
          />
        </UFormField>

        <template v-if="parsed">
          <!-- Column mapping: the parser's guess, correctable per column. Each select
               gets a real UFormField label rather than a bare span, so the control is
               programmatically labelled and not just visually captioned. -->
          <div class="flex flex-wrap gap-3">
            <UFormField
              v-for="(header, i) in parsed.headers"
              :key="i"
              :label="labelFor(header, i)"
              size="xs"
              class="w-40"
            >
              <USelect
                :model-value="fieldFor(i, header)"
                :items="FIELD_OPTIONS"
                size="sm"
                class="w-full"
                @update:model-value="(v: string) => overrides[i] = v as ImportableField | 'ignore'"
              />
            </UFormField>
          </div>

          <!-- Preview: one row per pasted line, with why it will or won't import. -->
          <SalesEventWorkspaceProductImportPreview
            :rows="rows"
            :relations="relations"
            :forced="forced"
            @toggle-forced="toggleForced"
          />
        </template>
      </div>
    </template>

    <template #footer>
      <div class="flex justify-end gap-2 w-full">
        <UButton color="neutral" variant="ghost" :disabled="submitting" @click="open = false">
          {{ t('common.cancel', 'Cancel') }}
        </UButton>
        <UButton
          color="primary"
          icon="i-lucide-download"
          :loading="submitting"
          :disabled="!importableCount"
          @click="submit"
        >
          {{ t('sales.import.confirm', 'Import') }} ({{ importableCount }})
        </UButton>
      </div>
    </template>
  </UModal>
</template>
