<template>
  <div class="relative flex flex-col gap-2">
    <div class="absolute -top-2 -right-2 z-30">
      <UButton
        v-if="model"
        icon="i-lucide-x"
        color="error"
        variant="solid"
        size="xs"
        @click="removeImage"
      />
    </div>
    <button
      type="button"
      class="relative z-20 flex h-40 w-full cursor-pointer flex-col items-center justify-center gap-2 overflow-hidden rounded-lg bg-neutral-50 hover:bg-neutral-100 dark:bg-neutral-800 dark:hover:bg-neutral-900"
      @click="open()"
    >
      <UIcon
        v-if="!model"
        name="i-lucide-image-plus"
        class="h-4 w-5 text-neutral-400"
      />
      <img
        v-else
        :src="model"
        class="h-full w-full"
        :class="fit === 'contain' ? 'object-contain p-3' : 'object-cover'"
      >
    </button>

    <!-- Crop Modal -->
    <UModal v-model:open="showCropper">
      <template #content="{ close }">
        <div class="p-6">
          <h3 class="text-lg font-semibold mb-4">
            {{ t('image.cropImage') }}
          </h3>
          <CroutonImageCropper
            v-if="pendingFile"
            :file="pendingFile"
            :aspect-ratio="cropAspectRatio"
            :circular="cropCircular"
            @confirm="handleCropConfirm($event, close)"
            @cancel="handleCropCancel(close)"
          />
        </div>
      </template>
    </UModal>
  </div>
</template>

<script setup lang="ts">
import { useFileDialog, useObjectUrl } from '@vueuse/core'
import type { AspectRatioPreset } from '../composables/useImageCrop'

const { t } = useT()

interface Props {
  crop?: boolean | { aspectRatio?: number | AspectRatioPreset, circular?: boolean }
  /** Preview fit: 'cover' (default, photos) or 'contain' (logos — show the whole image) */
  fit?: 'cover' | 'contain'
}

const props = withDefaults(defineProps<Props>(), {
  crop: false,
  fit: 'cover'
})

const model = defineModel<string | undefined>()

const { files, open, onChange } = useFileDialog({
  accept: 'image/*',
  multiple: false
})

const emit = defineEmits<{
  'file-selected': [file: File | null]
}>()

const showCropper = ref(false)
const pendingFile = ref<File | null>(null)

const cropEnabled = computed(() => !!props.crop)
const cropAspectRatio = computed(() => {
  if (typeof props.crop === 'object' && props.crop.aspectRatio) {
    return props.crop.aspectRatio
  }
  return undefined
})
const cropCircular = computed(() => {
  if (typeof props.crop === 'object') {
    return props.crop.circular || false
  }
  return false
})

onChange(() => {
  const file = files.value?.[0]
  if (!file) return

  if (cropEnabled.value) {
    pendingFile.value = file
    showCropper.value = true
  } else {
    const objectUrl = useObjectUrl(file)
    model.value = objectUrl.value
    emit('file-selected', file)
  }
})

const handleCropConfirm = (croppedFile: File, close: () => void) => {
  const objectUrl = useObjectUrl(croppedFile)
  model.value = objectUrl.value
  emit('file-selected', croppedFile)
  pendingFile.value = null
  close()
  showCropper.value = false
}

const handleCropCancel = (close: () => void) => {
  pendingFile.value = null
  close()
  showCropper.value = false
}

const removeImage = () => {
  model.value = undefined
  emit('file-selected', null)
}
</script>
