<script setup lang="ts">
/**
 * File property editor for block editor.
 * Upload a file via /api/upload-image (supports all file types).
 * Shows current file name + change/delete buttons.
 */
import { ref, computed, watch } from 'vue'

interface Props {
  modelValue: string
}

const props = defineProps<Props>()

const emit = defineEmits<{
  'update:modelValue': [value: string]
  'update:fileName': [value: string]
}>()

type Mode = 'preview' | 'upload'
const mode = ref<Mode>(props.modelValue ? 'preview' : 'upload')
const isUploading = ref(false)

const { t } = useT()
const hasFile = computed(() => !!props.modelValue)

// Extract display name from URL path
const displayName = computed(() => {
  if (!props.modelValue) return ''
  const parts = props.modelValue.split('/')
  return decodeURIComponent(parts[parts.length - 1] || '')
})

watch(() => props.modelValue, (val) => {
  if (val) {
    mode.value = 'preview'
  }
})

function removeFile() {
  emit('update:modelValue', '')
  emit('update:fileName', '')
  mode.value = 'upload'
}

async function handleFileUpload(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return

  isUploading.value = true
  try {
    const formData = new FormData()
    formData.append('file', file)

    const result = await globalThis.$fetch<{ pathname: string }>('/api/upload-image', {
      method: 'POST',
      body: formData
    })

    const fileUrl = `/images/${result.pathname}`
    emit('update:modelValue', fileUrl)
    emit('update:fileName', file.name)
    mode.value = 'preview'
  }
  catch (err) {
    console.error('File upload failed:', err)
  }
  finally {
    isUploading.value = false
    // Reset input so same file can be re-selected
    input.value = ''
  }
}
</script>

<template>
  <div class="space-y-3">
    <!-- File Preview -->
    <div v-if="hasFile && mode === 'preview'" class="space-y-2">
      <div class="flex items-center gap-3 rounded-lg border border-default p-3 bg-muted">
        <UIcon name="i-lucide-file" class="size-5 text-primary shrink-0" />
        <span class="text-sm text-default truncate flex-1">
          {{ displayName }}
        </span>
        <div class="flex gap-1 shrink-0">
          <UButton
            icon="i-lucide-replace"
            color="neutral"
            variant="ghost"
            size="xs"
            @click="mode = 'upload'"
          />
          <UButton
            icon="i-lucide-trash-2"
            color="error"
            variant="ghost"
            size="xs"
            @click="removeFile"
          />
        </div>
      </div>
    </div>

    <!-- Upload Mode -->
    <div v-if="mode === 'upload'" class="space-y-2">
      <label
        class="flex flex-col items-center justify-center h-24 rounded-lg border-2 border-dashed border-default bg-muted cursor-pointer hover:border-primary/50 transition-colors"
      >
        <UIcon v-if="!isUploading" name="i-lucide-upload" class="size-6 text-dimmed mb-1" />
        <UIcon v-else name="i-lucide-loader-2" class="size-6 text-dimmed mb-1 animate-spin" />
        <span class="text-xs text-muted">
          {{ isUploading ? t('pages.blocks.media.uploading') : t('pages.blocks.file.clickToUpload') }}
        </span>
        <input
          type="file"
          class="hidden"
          :disabled="isUploading"
          @change="handleFileUpload"
        >
      </label>
      <UButton
        v-if="hasFile"
        :label="t('common.cancel')"
        variant="ghost"
        color="neutral"
        size="xs"
        @click="mode = 'preview'"
      />
    </div>
  </div>
</template>
