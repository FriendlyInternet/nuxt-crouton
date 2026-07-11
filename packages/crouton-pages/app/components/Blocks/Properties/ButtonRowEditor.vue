<script setup lang="ts">
/**
 * Button Row Editor
 *
 * Editor for managing button arrays in the button row block.
 * Each button can be a link (internal/external URL) or a file download.
 */
import { ref, watch } from 'vue'
import type { ButtonRowItem } from '../../../types/blocks'

interface Props {
  modelValue: ButtonRowItem[]
}

const props = defineProps<Props>()

const emit = defineEmits<{
  'update:modelValue': [value: ButtonRowItem[]]
}>()

const colorOptions = computed(() => [
  { label: t('pages.blocks.colors.primary'), value: 'primary' },
  { label: t('pages.blocks.colors.secondary'), value: 'secondary' },
  { label: t('pages.blocks.colors.neutral'), value: 'neutral' },
  { label: t('pages.blocks.colors.success'), value: 'success' },
  { label: t('pages.blocks.colors.warning'), value: 'warning' },
  { label: t('pages.blocks.colors.error'), value: 'error' }
])

const variantOptions = computed(() => [
  { label: t('pages.blocks.variants.solid'), value: 'solid' },
  { label: t('pages.blocks.variants.outline'), value: 'outline' },
  { label: t('pages.blocks.variants.soft'), value: 'soft' },
  { label: t('pages.blocks.variants.ghost'), value: 'ghost' },
  { label: t('pages.blocks.variants.link'), value: 'link' }
])

const { t } = useT()

// CMS pages for the "link to a page" picker.
const { pageOptions } = usePageLink()

const buttons = ref<ButtonRowItem[]>([...props.modelValue])

// A button links either to a CMS page (pageId set) or a custom URL.
function linkMode(btn: ButtonRowItem): 'page' | 'url' {
  return btn.pageId !== undefined ? 'page' : 'url'
}

function setLinkMode(index: number, mode: 'page' | 'url') {
  const btn = { ...buttons.value[index]! } as ButtonRowItem
  if (mode === 'page') {
    // Page links are internal — drop the free URL and new-tab flag.
    btn.pageId = btn.pageId ?? ''
    btn.to = undefined
    btn.external = undefined
  } else {
    btn.pageId = undefined
  }
  buttons.value[index] = btn
  emitChange()
}

watch(() => props.modelValue, (newVal) => {
  buttons.value = [...newVal]
}, { deep: true })

function emitChange() {
  emit('update:modelValue', [...buttons.value])
}

function addButton() {
  buttons.value.push({
    label: t('pages.blocks.defaults.newButton'),
    to: '',
    color: 'primary',
    variant: 'solid'
  })
  emitChange()
}

function removeButton(index: number) {
  buttons.value.splice(index, 1)
  emitChange()
}

function updateButton(index: number, field: keyof ButtonRowItem, value: any) {
  buttons.value[index] = { ...buttons.value[index], [field]: value } as ButtonRowItem
  emitChange()
}

function toggleDownloadMode(index: number, isDownload: boolean) {
  const btn = { ...buttons.value[index]!, download: isDownload } as ButtonRowItem
  if (isDownload) {
    // Switching to download mode — clear link fields
    btn.to = undefined
    btn.external = undefined
  }
  else {
    // Switching to link mode — clear file fields
    btn.file = undefined
    btn.fileName = undefined
  }
  buttons.value[index] = btn
  emitChange()
}

function moveButton(index: number, direction: 'up' | 'down') {
  const newIndex = direction === 'up' ? index - 1 : index + 1
  if (newIndex < 0 || newIndex >= buttons.value.length) return

  const temp = buttons.value[index]!
  buttons.value[index] = buttons.value[newIndex]!
  buttons.value[newIndex] = temp
  emitChange()
}

// File upload handler (reuses same pattern as FileEditor)
const uploadingIndex = ref<number | null>(null)

async function handleFileUpload(event: Event, index: number) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return

  uploadingIndex.value = index
  try {
    const formData = new FormData()
    formData.append('file', file)

    const result = await globalThis.$fetch<{ pathname: string }>('/api/upload-image', {
      method: 'POST',
      body: formData
    })

    const fileUrl = `/images/${result.pathname}`
    const btn = { ...buttons.value[index]!, file: fileUrl, fileName: file.name } as ButtonRowItem
    buttons.value[index] = btn
    emitChange()
  }
  catch (err) {
    console.error('File upload failed:', err)
  }
  finally {
    uploadingIndex.value = null
    input.value = ''
  }
}

function removeFile(index: number) {
  const btn = { ...buttons.value[index]!, file: undefined, fileName: undefined } as ButtonRowItem
  buttons.value[index] = btn
  emitChange()
}
</script>

<template>
  <div class="button-row-editor space-y-3">
    <!-- Button Items -->
    <div
      v-for="(btn, index) in buttons"
      :key="index"
      class="p-3 border border-default rounded-lg space-y-2"
    >
      <!-- Header with move/delete -->
      <div class="flex items-center justify-between">
        <span class="text-sm font-medium">{{ t('pages.blocks.links.buttonN', { n: index + 1 } as any) }}</span>
        <div class="flex items-center gap-1">
          <UButton
            color="neutral"
            variant="ghost"
            icon="i-lucide-chevron-up"
            size="xs"
            :disabled="index === 0"
            @click="moveButton(index, 'up')"
          />
          <UButton
            color="neutral"
            variant="ghost"
            icon="i-lucide-chevron-down"
            size="xs"
            :disabled="index === buttons.length - 1"
            @click="moveButton(index, 'down')"
          />
          <UButton
            color="error"
            variant="ghost"
            icon="i-lucide-trash-2"
            size="xs"
            @click="removeButton(index)"
          />
        </div>
      </div>

      <!-- Mode toggle: Link / Download -->
      <div class="flex items-center gap-2">
        <UButtonGroup size="xs" class="w-full">
          <UButton
            :color="!btn.download ? 'primary' : 'neutral'"
            :variant="!btn.download ? 'solid' : 'outline'"
            icon="i-lucide-link"
            :label="t('pages.blocks.buttonRow.modeLink')"
            class="flex-1"
            @click="toggleDownloadMode(index, false)"
          />
          <UButton
            :color="btn.download ? 'primary' : 'neutral'"
            :variant="btn.download ? 'solid' : 'outline'"
            icon="i-lucide-download"
            :label="t('pages.blocks.buttonRow.modeDownload')"
            class="flex-1"
            @click="toggleDownloadMode(index, true)"
          />
        </UButtonGroup>
      </div>

      <!-- Label -->
      <UInput
        :model-value="btn.label"
        :placeholder="t('pages.blocks.links.buttonTextPlaceholder')"
        size="sm"
        @update:model-value="updateButton(index, 'label', $event)"
      />

      <!-- Link mode: page picker or custom URL -->
      <template v-if="!btn.download">
        <!-- Sub-toggle: link to a CMS page vs a custom URL -->
        <UButtonGroup size="xs" class="w-full">
          <UButton
            :color="linkMode(btn) === 'page' ? 'primary' : 'neutral'"
            :variant="linkMode(btn) === 'page' ? 'solid' : 'outline'"
            icon="i-lucide-file-text"
            :label="t('pages.blocks.buttonRow.linkPage')"
            class="flex-1"
            @click="setLinkMode(index, 'page')"
          />
          <UButton
            :color="linkMode(btn) === 'url' ? 'primary' : 'neutral'"
            :variant="linkMode(btn) === 'url' ? 'solid' : 'outline'"
            icon="i-lucide-link"
            :label="t('pages.blocks.buttonRow.linkUrl')"
            class="flex-1"
            @click="setLinkMode(index, 'url')"
          />
        </UButtonGroup>

        <!-- Page mode: pick a page from the CMS -->
        <USelectMenu
          v-if="linkMode(btn) === 'page'"
          :model-value="btn.pageId || ''"
          :items="pageOptions"
          value-key="value"
          size="sm"
          :placeholder="t('pages.blocks.buttonRow.selectPage')"
          :search-input="{ placeholder: t('pages.blocks.buttonRow.searchPages') }"
          @update:model-value="updateButton(index, 'pageId', $event)"
        >
          <template #leading>
            <UIcon name="i-lucide-file-text" class="size-3" />
          </template>
        </USelectMenu>

        <!-- URL mode: free-text URL + new-tab toggle -->
        <template v-else>
          <UInput
            :model-value="btn.to || ''"
            :placeholder="t('pages.blocks.links.urlPlaceholder')"
            size="sm"
            @update:model-value="updateButton(index, 'to', $event)"
          >
            <template #leading>
              <UIcon name="i-lucide-link" class="size-3" />
            </template>
          </UInput>

          <div class="flex items-center gap-2">
            <USwitch
              :model-value="btn.external || false"
              size="xs"
              @update:model-value="updateButton(index, 'external', $event)"
            />
            <span class="text-xs text-muted">{{ t('pages.blocks.buttonRow.openInNewTab') }}</span>
          </div>
        </template>
      </template>

      <!-- Download mode: File upload -->
      <template v-else>
        <!-- File preview -->
        <div v-if="btn.file" class="flex items-center gap-2 rounded-md border border-default p-2 bg-muted">
          <UIcon name="i-lucide-file" class="size-4 text-primary shrink-0" />
          <span class="text-xs text-toned truncate flex-1">
            {{ btn.fileName || btn.file.split('/').pop() }}
          </span>
          <UButton
            icon="i-lucide-trash-2"
            color="error"
            variant="ghost"
            size="xs"
            @click="removeFile(index)"
          />
        </div>

        <!-- Upload zone -->
        <label
          v-else
          class="flex flex-col items-center justify-center h-16 rounded-md border-2 border-dashed border-default bg-muted cursor-pointer hover:border-primary/50 transition-colors"
        >
          <UIcon
            :name="uploadingIndex === index ? 'i-lucide-loader-2' : 'i-lucide-upload'"
            :class="['size-4 text-dimmed', { 'animate-spin': uploadingIndex === index }]"
          />
          <span class="text-[10px] text-muted mt-1">
            {{ uploadingIndex === index ? t('pages.blocks.media.uploading') : t('pages.blocks.media.clickToUpload') }}
          </span>
          <input
            type="file"
            class="hidden"
            :disabled="uploadingIndex === index"
            @change="handleFileUpload($event, index)"
          >
        </label>
      </template>

      <!-- Color & Variant -->
      <div class="grid grid-cols-2 gap-2">
        <USelect
          :model-value="btn.color || 'primary'"
          :items="colorOptions"
          value-key="value"
          size="sm"
          @update:model-value="updateButton(index, 'color', $event)"
        />
        <USelect
          :model-value="btn.variant || 'solid'"
          :items="variantOptions"
          value-key="value"
          size="sm"
          @update:model-value="updateButton(index, 'variant', $event)"
        />
      </div>

      <!-- Icon (optional) -->
      <CroutonIconPicker
        :model-value="btn.icon || ''"
        size="sm"
        :placeholder="t('pages.blocks.addIcon')"
        @update:model-value="updateButton(index, 'icon', $event)"
      />
    </div>

    <!-- Add Button -->
    <UButton
      color="neutral"
      variant="outline"
      icon="i-lucide-plus"
      size="sm"
      block
      @click="addButton"
    >
      {{ t('pages.blocks.links.addButton') }}
    </UButton>
  </div>
</template>
