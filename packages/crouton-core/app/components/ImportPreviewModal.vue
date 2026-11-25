<script setup lang="ts">
import type { ImportField, ImportColumnMapping, ImportRowValidation, ImportResult } from '../composables/useCollectionImport'
import { useTimeoutFn } from '@vueuse/core'

interface Props {
  collection: string
  file: File | null
}

const props = defineProps<Props>()

const emit = defineEmits<{
  'import-complete': [result: ImportResult]
  'close': []
}>()

const isOpen = defineModel<boolean>('open', { default: false })

const { t, tString } = useT()
const {
  parseFile,
  getCollectionFields,
  autoMapColumns,
  validateRows,
  executeImport,
  isImporting,
  progress
} = useCollectionImport(props.collection)

const SKIP = '__skip__'

type Step = 'mapping' | 'preview' | 'importing' | 'complete'
const step = ref<Step>('mapping')

// Data
const rows = ref<Record<string, any>[]>([])
const csvColumns = ref<string[]>([])
const fields = ref<ImportField[]>([])
const mappings = ref<ImportColumnMapping[]>([])
const validationResults = ref<ImportRowValidation[]>([])
const skipInvalid = ref(true)
const importResult = ref<ImportResult | null>(null)
const readError = ref<string | null>(null)
const noFields = ref(false)
const importError = ref<string | null>(null)

const failedRows = computed(() => importResult.value?.errors ?? [])

const validCount = computed(() => validationResults.value.filter(r => r.valid).length)
const invalidCount = computed(() => validationResults.value.filter(r => !r.valid).length)

// Dropdown options for column mapping
const fieldOptions = computed(() => {
  const opts = fields.value.map(f => ({
    label: `${f.label}${f.required ? ' *' : ''}`,
    value: f.key
  }))
  // A select item may not have an empty-string value, so skip gets a sentinel
  return [{ label: t('import.skipColumn'), value: SKIP }, ...opts]
})

// Table columns for preview
const previewColumns = computed(() => {
  const mapped = mappings.value.filter(m => m.fieldKey)
  return [
    { key: '_status', label: t('import.statusColumn') },
    ...mapped.map(m => ({
      key: m.fieldKey!,
      label: fields.value.find(f => f.key === m.fieldKey)?.label || m.fieldKey!
    }))
  ]
})

// Table rows for preview (first 50)
const previewRows = computed(() => {
  return validationResults.value.slice(0, 50).map((result) => ({
    ...result.data,
    _status: result.valid ? 'valid' : 'invalid',
    _errors: result.errors,
    _rowIndex: result.rowIndex
  } as Record<string, any>))
})

// Parse file on open
watch(() => props.file, async (file) => {
  if (!file) return
  readError.value = null
  noFields.value = false
  importError.value = null
  try {
    const parsed = await parseFile(file)
    rows.value = parsed.rows
    csvColumns.value = parsed.columns
    fields.value = getCollectionFields()
    if (fields.value.length === 0) {
      noFields.value = true
      mappings.value = []
    } else {
      mappings.value = autoMapColumns(parsed.columns, fields.value)
    }
    step.value = 'mapping'
  } catch (error: any) {
    console.error('[ImportPreviewModal] Parse error:', error)
    readError.value = error?.message || String(error)
    step.value = 'mapping'
  }
}, { immediate: true })

function updateMapping(index: number, fieldKey: string) {
  mappings.value[index] = {
    ...mappings.value[index]!,
    fieldKey: fieldKey && fieldKey !== SKIP ? fieldKey : null
  }
}

function goToPreview() {
  validationResults.value = validateRows(rows.value, mappings.value, fields.value)
  step.value = 'preview'
}

async function startImport() {
  step.value = 'importing'
  importError.value = null
  const list = skipInvalid.value
    ? validationResults.value.filter(r => r.valid)
    : validationResults.value

  try {
    const result = await executeImport(list.map(r => r.data), list.map(r => r.rowIndex))
    importResult.value = result
    step.value = 'complete'
    emit('import-complete', result)
  } catch (e: any) {
    importError.value = e?.message || String(e)
    step.value = 'preview'
  }
}

const { start: startResetState } = useTimeoutFn(() => {
  step.value = 'mapping'
  rows.value = []
  csvColumns.value = []
  fields.value = []
  mappings.value = []
  readError.value = null
  noFields.value = false
  importError.value = null
  validationResults.value = []
  importResult.value = null
}, 300, { immediate: false })

function close() {
  isOpen.value = false
  emit('close')
  // Reset state after animation
  startResetState()
}
</script>

<template>
  <UModal v-model:open="isOpen" :ui="{ content: 'max-w-4xl' }">
    <template #content>
      <div class="p-6">
        <!-- Header -->
        <div class="flex items-center justify-between mb-6">
          <h3 class="text-lg font-semibold">
            {{ tString('common.import') || 'Import' }} {{ collection }}
          </h3>
          <div class="flex items-center gap-2 text-sm text-muted">
            <span
              v-for="(s, i) in [t('import.mapping'), t('import.preview'), t('import.importing'), t('import.importComplete')]"
              :key="s"
              :class="[
                i === ['mapping', 'preview', 'importing', 'complete'].indexOf(step)
                  ? 'text-primary font-medium'
                  : 'text-muted'
              ]"
            >
              {{ s }}
              <span v-if="i < 3" class="mx-1">&rarr;</span>
            </span>
          </div>
        </div>

        <!-- Step 1: Column Mapping -->
        <div v-if="step === 'mapping'" class="space-y-4">
          <UAlert
            v-if="readError"
            color="error"
            variant="subtle"
            :title="t('import.readFailed')"
            :description="readError"
          />
          <UAlert
            v-if="noFields"
            color="error"
            variant="subtle"
            :title="t('import.noFields')"
          />
          <p class="text-sm text-muted">
            {{ t('import.mapColumnsHint') }}
          </p>

          <div class="space-y-2 max-h-96 overflow-y-auto">
            <div
              v-for="(mapping, i) in mappings"
              :key="mapping.csvColumn"
              class="flex items-center gap-4 p-2 rounded-lg hover:bg-muted/50"
            >
              <div class="w-1/2 font-mono text-sm truncate">
                {{ mapping.csvColumn }}
              </div>
              <UIcon name="i-lucide-arrow-right" class="shrink-0 text-muted" />
              <div class="w-1/2">
                <USelect
                  :model-value="mapping.fieldKey || SKIP"
                  :items="fieldOptions"
                  value-key="value"
                  size="sm"
                  @update:model-value="updateMapping(i, $event)"
                />
              </div>
            </div>
          </div>

          <div class="flex justify-between items-center pt-4 border-t border-default">
            <span class="text-sm text-muted">
              {{ t('import.rowsFound', { count: rows.length }) }}
            </span>
            <div class="flex gap-2">
              <UButton variant="ghost" @click="close">
                {{ t('common.cancel') }}
              </UButton>
              <UButton
                color="primary"
                :disabled="!mappings.some(m => m.fieldKey)"
                @click="goToPreview"
              >
                {{ t('common.next') }}
              </UButton>
            </div>
          </div>
        </div>

        <!-- Step 2: Preview & Validation -->
        <div v-if="step === 'preview'" class="space-y-4">
          <UAlert
            v-if="importError"
            color="error"
            variant="subtle"
            :title="t('import.failed')"
            :description="importError"
          />
          <!-- Summary bar -->
          <div class="flex items-center gap-4 p-3 rounded-lg bg-muted/50">
            <UBadge color="success" variant="subtle">
              {{ t('import.validCount', { count: validCount }) }}
            </UBadge>
            <UBadge v-if="invalidCount > 0" color="error" variant="subtle">
              {{ t('import.invalidCount', { count: invalidCount }) }}
            </UBadge>
            <div v-if="invalidCount > 0" class="ml-auto">
              <label class="flex items-center gap-2 text-sm">
                <USwitch v-model="skipInvalid" size="sm" />
                {{ t('import.skipInvalid') }}
              </label>
            </div>
          </div>

          <!-- Preview table -->
          <div class="max-h-80 overflow-auto rounded-lg border border-default">
            <table class="w-full text-sm">
              <thead class="bg-muted/50 sticky top-0">
                <tr>
                  <th
                    v-for="col in previewColumns"
                    :key="col.key"
                    class="px-3 py-2 text-left font-medium whitespace-nowrap"
                  >
                    {{ col.label }}
                  </th>
                </tr>
              </thead>
              <tbody>
                <tr
                  v-for="row in previewRows"
                  :key="row._rowIndex"
                  :class="row._status === 'invalid' ? 'bg-error/5' : ''"
                >
                  <td class="px-3 py-1.5">
                    <UBadge
                      :color="row._status === 'valid' ? 'success' : 'error'"
                      variant="subtle"
                      size="xs"
                    >
                      {{ row._status === 'valid' ? t('import.statusOk') : t('import.statusError') }}
                    </UBadge>
                  </td>
                  <td
                    v-for="col in previewColumns.slice(1)"
                    :key="col.key"
                    class="px-3 py-1.5 truncate max-w-48"
                    :title="row._errors?.[col.key] || String(row[col.key] ?? '')"
                  >
                    <span
                      v-if="row._errors?.[col.key]"
                      class="text-error text-xs"
                    >
                      {{ row._errors[col.key] }}
                    </span>
                    <span v-else>{{ row[col.key] ?? '' }}</span>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          <div class="flex justify-between items-center pt-4 border-t border-default">
            <span class="text-sm text-muted">
              {{ t('import.willImport', { count: skipInvalid ? validCount : rows.length }) }}
            </span>
            <div class="flex gap-2">
              <UButton variant="ghost" @click="step = 'mapping'">
                {{ t('common.back') }}
              </UButton>
              <UButton
                color="primary"
                :disabled="skipInvalid ? validCount === 0 : rows.length === 0"
                @click="startImport"
              >
                {{ t('common.import') }}
              </UButton>
            </div>
          </div>
        </div>

        <!-- Step 3: Importing -->
        <div v-if="step === 'importing'" class="space-y-6 py-8">
          <div class="text-center">
            <UIcon name="i-lucide-loader" class="size-8 animate-spin text-primary mx-auto mb-4" />
            <p class="text-sm text-muted">
              {{ t('import.importingRows', { count: skipInvalid ? validCount : rows.length }) }}
            </p>
          </div>
          <UProgress :value="progress" />
          <p class="text-center text-xs text-muted">
            {{ t('import.percentComplete', { percent: progress }) }}
          </p>
        </div>

        <!-- Step 4: Complete -->
        <div v-if="step === 'complete'" class="space-y-6 py-8">
          <div class="text-center">
            <UIcon
              :name="importResult?.failed ? 'i-lucide-alert-triangle' : 'i-lucide-check-circle'"
              :class="[
                'size-12 mx-auto mb-4',
                importResult?.failed ? 'text-warning' : 'text-success'
              ]"
            />
            <h4 class="text-lg font-semibold mb-2">{{ t('import.importComplete') }}</h4>
            <div class="space-y-1 text-sm text-muted">
              <p>{{ t('import.itemsCreated', { count: importResult?.created }) }}</p>
              <p v-if="importResult?.failed">{{ t('import.itemsFailed', { count: importResult.failed }) }}</p>
              <p v-if="invalidCount > 0 && skipInvalid">{{ t('import.rowsSkipped', { count: invalidCount }) }}</p>
            </div>
            <ul v-if="failedRows.length" class="failed-rows mt-4 space-y-1 text-sm text-error text-left max-h-48 overflow-y-auto">
              <li v-for="e in failedRows.slice(0, 20)" :key="e.rowIndex">
                {{ t('import.rowFailed', { row: e.rowIndex + 1, error: e.error }) }}
              </li>
              <li v-if="failedRows.length > 20" class="text-muted">
                {{ t('import.moreFailed', { count: failedRows.length - 20 }) }}
              </li>
            </ul>
          </div>

          <div class="flex justify-center pt-4">
            <UButton color="primary" @click="close">
              {{ t('common.close') }}
            </UButton>
          </div>
        </div>
      </div>
    </template>
  </UModal>
</template>
