<script setup lang="ts">
/**
 * Image property editor for block editor.
 * Three modes: browse assets (if crouton-assets installed), upload new, paste URL.
 * Follows LinksEditor.vue pattern with modelValue + update:modelValue.
 * Emits update:alt when an asset with alt text is picked from the library.
 *
 * Supports optional `crop` config per field schema. When provided:
 * - Upload mode passes crop to CroutonImageUpload (crop-on-upload)
 * - Browse mode opens CroutonImageCropper after asset selection
 * - Preview mode shows a crop button to re-crop existing images
 */
import type { BlockImageCropAspectRatio } from '../../../types/blocks'

interface Props {
  modelValue: string
  crop?: { aspectRatio?: BlockImageCropAspectRatio; circular?: boolean }
}

const props = defineProps<Props>()

const emit = defineEmits<{
  'update:modelValue': [value: string]
  'update:alt': [value: string]
}>()

// Detect if crouton-assets is installed via the croutonApps registry
const { hasApp } = useCroutonApps()
const hasAssetsPicker = hasApp('assets')

type Mode = 'preview' | 'url' | 'upload' | 'browse'
const mode = ref<Mode>(hasAssetsPicker && !props.modelValue ? 'browse' : 'preview')
const urlInput = ref(props.modelValue || '')

// Sync local URL with props
watch(() => props.modelValue, (val) => {
  urlInput.value = val || ''
})

const { t } = useT()
const hasImage = computed(() => !!props.modelValue)

// --- Crop state ---
const cropModalOpen = ref(false)
const cropFile = ref<File | null>(null)
// Pending alt text from browse-mode asset selection (applied after crop completes)
const pendingAlt = ref<string | null>(null)

/** Fetch an image URL as a File for the cropper */
async function fetchImageAsFile(url: string): Promise<File> {
  const response = await fetch(url)
  const blob = await response.blob()
  const filename = url.split('/').pop() || 'image.jpg'
  return new File([blob], filename, { type: blob.type })
}

/** Upload a cropped file and emit the new URL */
async function uploadCroppedFile(file: File) {
  const formData = new FormData()
  formData.append('file', file)
  const result = await $fetch<{ pathname: string }>('/api/upload-image', {
    method: 'POST',
    body: formData
  })
  const imageUrl = `/images/${result.pathname}`
  emit('update:modelValue', imageUrl)
  urlInput.value = imageUrl
  mode.value = 'preview'
}

/** Open the crop modal for an existing image (re-crop flow) */
async function openRecrop() {
  try {
    cropFile.value = await fetchImageAsFile(props.modelValue)
    cropModalOpen.value = true
  }
  catch (err) {
    console.error('Failed to load image for cropping:', err)
  }
}

/** Handle crop confirm from CroutonImageCropper */
async function handleCropConfirm(croppedFile: File) {
  cropModalOpen.value = false
  cropFile.value = null
  try {
    await uploadCroppedFile(croppedFile)
    // Apply pending alt text from browse-mode selection
    if (pendingAlt.value) {
      emit('update:alt', pendingAlt.value)
      pendingAlt.value = null
    }
  }
  catch (err) {
    console.error('Crop upload failed:', err)
  }
}

/** Handle crop cancel */
function handleCropCancel() {
  cropModalOpen.value = false
  cropFile.value = null
  pendingAlt.value = null
}

function setUrl() {
  emit('update:modelValue', urlInput.value)
  mode.value = 'preview'
}

function removeImage() {
  emit('update:modelValue', '')
  urlInput.value = ''
  mode.value = hasAssetsPicker ? 'browse' : 'preview'
}

function handleFileSelected(file: File | null) {
  if (!file) return

  const formData = new FormData()
  formData.append('file', file)

  $fetch<{ pathname: string }>('/api/upload-image', {
    method: 'POST',
    body: formData
  }).then((result) => {
    const imageUrl = `/images/${result.pathname}`
    emit('update:modelValue', imageUrl)
    urlInput.value = imageUrl
    mode.value = 'preview'
  }).catch((err) => {
    console.error('Image upload failed:', err)
  })
}

async function handleAssetSelected(asset: Record<string, any>) {
  const url = `/images/${asset.pathname}`

  // If crop is configured, open cropper before confirming
  if (props.crop) {
    try {
      cropFile.value = await fetchImageAsFile(url)
      pendingAlt.value = asset.alt || null
      cropModalOpen.value = true
    }
    catch (err) {
      console.error('Failed to load asset for cropping:', err)
      // Fall through to direct assignment on error
      emit('update:modelValue', url)
      urlInput.value = url
      if (asset.alt) emit('update:alt', asset.alt)
      mode.value = 'preview'
    }
    return
  }

  emit('update:modelValue', url)
  urlInput.value = url
  if (asset.alt) {
    emit('update:alt', asset.alt)
  }
  mode.value = 'preview'
}
</script>

<template>
  <div class="space-y-3">
    <!-- Image Preview -->
    <div v-if="hasImage && mode === 'preview'" class="space-y-2">
      <div class="relative rounded-lg border border-default">
        <img
          :src="modelValue"
          alt="Preview"
          class="w-full max-h-48 object-cover rounded-lg"
        >
        <div class="absolute top-2 right-2 flex gap-1">
          <UButton
            v-if="crop"
            icon="i-lucide-crop"
            color="neutral"
            variant="solid"
            size="xs"
            @click="openRecrop"
          />
          <UButton
            icon="i-lucide-pencil"
            color="neutral"
            variant="solid"
            size="xs"
            @click="mode = 'url'"
          />
          <UButton
            icon="i-lucide-trash-2"
            color="error"
            variant="solid"
            size="xs"
            @click="removeImage"
          />
        </div>
      </div>
    </div>

    <!-- No Image State — Browse tab shown first if available -->
    <div v-if="!hasImage && mode === 'preview'" class="flex flex-col gap-2">
      <div class="flex items-center justify-center h-32 rounded-lg border-2 border-dashed border-default bg-muted">
        <div class="text-center">
          <UIcon name="i-lucide-image" class="size-8 text-dimmed mb-2" />
          <p class="text-sm text-muted">
            {{ t('pages.blocks.image.noImage') }}
          </p>
        </div>
      </div>
      <div class="flex gap-2">
        <UButton
          v-if="hasAssetsPicker"
          icon="i-lucide-folder-open"
          :label="t('pages.blocks.media.browse')"
          variant="soft"
          color="neutral"
          size="xs"
          class="flex-1"
          @click="mode = 'browse'"
        />
        <UButton
          icon="i-lucide-link"
          :label="t('pages.blocks.media.pasteUrl')"
          variant="soft"
          color="neutral"
          size="xs"
          class="flex-1"
          @click="mode = 'url'"
        />
        <UButton
          icon="i-lucide-upload"
          :label="t('pages.blocks.media.upload')"
          variant="soft"
          color="neutral"
          size="xs"
          class="flex-1"
          @click="mode = 'upload'"
        />
      </div>
    </div>

    <!-- Browse Library Mode -->
    <div v-if="mode === 'browse' && hasAssetsPicker" class="space-y-2">
      <Suspense>
        <CroutonAssetsPicker
          @select="handleAssetSelected"
        />
        <template #fallback>
          <div class="h-32 flex items-center justify-center text-sm text-muted">
            {{ t('pages.blocks.media.loadingLibrary') }}
          </div>
        </template>
      </Suspense>
      <div class="flex gap-2 pt-1">
        <UButton
          icon="i-lucide-upload"
          :label="t('pages.blocks.media.uploadInstead')"
          variant="ghost"
          color="neutral"
          size="xs"
          @click="mode = 'upload'"
        />
        <UButton
          icon="i-lucide-link"
          :label="t('pages.blocks.media.pasteUrl')"
          variant="ghost"
          color="neutral"
          size="xs"
          @click="mode = 'url'"
        />
        <UButton
          v-if="hasImage"
          :label="t('common.cancel')"
          variant="ghost"
          color="neutral"
          size="xs"
          @click="mode = 'preview'"
        />
      </div>
    </div>

    <!-- URL Input Mode -->
    <div v-if="mode === 'url'" class="space-y-2">
      <UInput
        v-model="urlInput"
        placeholder="https://example.com/image.jpg or /images/..."
        size="sm"
        class="w-full"
      >
        <template #leading>
          <UIcon name="i-lucide-link" class="size-4" />
        </template>
      </UInput>
      <div class="flex gap-2">
        <UButton
          :label="t('common.apply')"
          color="primary"
          size="xs"
          @click="setUrl"
        />
        <UButton
          :label="t('common.cancel')"
          variant="ghost"
          color="neutral"
          size="xs"
          @click="mode = hasImage ? 'preview' : (hasAssetsPicker ? 'browse' : 'preview')"
        />
        <UButton
          v-if="hasAssetsPicker"
          icon="i-lucide-folder-open"
          :label="t('pages.blocks.media.browseLibrary')"
          variant="ghost"
          color="neutral"
          size="xs"
          @click="mode = 'browse'"
        />
        <UButton
          v-else
          icon="i-lucide-upload"
          :label="t('pages.blocks.media.uploadInstead')"
          variant="ghost"
          color="neutral"
          size="xs"
          @click="mode = 'upload'"
        />
      </div>
    </div>

    <!-- Upload Mode -->
    <div v-if="mode === 'upload'" class="space-y-2">
      <CroutonImageUpload
        :crop="crop ? { aspectRatio: crop.aspectRatio, circular: crop.circular } : false"
        @file-selected="handleFileSelected"
      />
      <div class="flex gap-2">
        <UButton
          :label="t('common.cancel')"
          variant="ghost"
          color="neutral"
          size="xs"
          @click="mode = hasImage ? 'preview' : (hasAssetsPicker ? 'browse' : 'preview')"
        />
        <UButton
          v-if="hasAssetsPicker"
          icon="i-lucide-folder-open"
          :label="t('pages.blocks.media.browseLibrary')"
          variant="ghost"
          color="neutral"
          size="xs"
          @click="mode = 'browse'"
        />
      </div>
    </div>

    <!-- Crop Modal (re-crop / post-browse-selection) -->
    <UModal v-model:open="cropModalOpen">
      <template #content="{ close }">
        <div class="p-6">
          <h3 class="text-lg font-semibold mb-4">
            {{ t('image.cropImage') }}
          </h3>
          <CroutonImageCropper
            v-if="cropFile"
            :file="cropFile"
            :aspect-ratio="crop?.aspectRatio"
            :circular="crop?.circular"
            @confirm="handleCropConfirm"
            @cancel="handleCropCancel"
          />
        </div>
      </template>
    </UModal>
  </div>
</template>
