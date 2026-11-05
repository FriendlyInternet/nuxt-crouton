<script setup lang="ts">
import type { AspectRatioPreset } from '../composables/useImageCrop'
import { useObjectUrl } from '@vueuse/core'

interface Props {
  file: File
  aspectRatio?: number | AspectRatioPreset
  circular?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  circular: false
})

const { t } = useT()

const emit = defineEmits<{
  confirm: [file: File]
  cancel: []
}>()

const imageRef = ref<HTMLImageElement | null>(null)
const objectUrl = useObjectUrl(computed(() => props.file))

const { setAspectRatio, rotate, zoom, reset, getCroppedFile, ASPECT_RATIOS } = useImageCrop(imageRef, {
  aspectRatio: props.aspectRatio
})

const currentAspectRatio = ref<AspectRatioPreset>(
  typeof props.aspectRatio === 'string' ? props.aspectRatio : 'free'
)

const aspectRatioOptions = Object.keys(ASPECT_RATIOS).map(key => ({
  label: key,
  value: key as AspectRatioPreset
}))

const handleAspectRatioChange = (preset: AspectRatioPreset) => {
  currentAspectRatio.value = preset
  setAspectRatio(preset)
}

const processing = ref(false)

const handleConfirm = async () => {
  processing.value = true
  try {
    const ext = props.file.name.split('.').pop() || 'png'
    const mimeType = props.file.type || 'image/png'
    const cropped = await getCroppedFile(`cropped-${Date.now()}.${ext}`, mimeType)
    if (cropped) {
      emit('confirm', cropped)
    }
  } finally {
    processing.value = false
  }
}
</script>

<template>
  <div class="flex flex-col gap-4">
    <!-- Crop Area -->
    <div
      class="crop-container relative bg-neutral-100 dark:bg-neutral-900 rounded-lg overflow-hidden"
      :class="circular ? 'rounded-full aspect-square' : ''"
    >
      <img
        v-if="objectUrl"
        ref="imageRef"
        :src="objectUrl"
        :alt="t('image.cropPreview')"
        class="block"
      >
    </div>

    <!-- Toolbar -->
    <div class="flex items-center justify-between gap-2 flex-wrap">
      <!-- Rotate -->
      <div class="flex items-center gap-1">
        <UButton
          icon="i-lucide-rotate-ccw"
          variant="ghost"
          color="neutral"
          size="sm"
          @click="rotate(-90)"
        />
        <UButton
          icon="i-lucide-rotate-cw"
          variant="ghost"
          color="neutral"
          size="sm"
          @click="rotate(90)"
        />
      </div>

      <!-- Zoom -->
      <div class="flex items-center gap-1">
        <UButton
          icon="i-lucide-zoom-out"
          variant="ghost"
          color="neutral"
          size="sm"
          @click="zoom(-0.1)"
        />
        <UButton
          icon="i-lucide-zoom-in"
          variant="ghost"
          color="neutral"
          size="sm"
          @click="zoom(0.1)"
        />
      </div>

      <!-- Aspect Ratio -->
      <USelect
        v-if="!circular"
        :model-value="currentAspectRatio"
        :items="aspectRatioOptions"
        size="sm"
        class="w-24"
        @update:model-value="handleAspectRatioChange($event as AspectRatioPreset)"
      />

      <!-- Reset -->
      <UButton
        icon="i-lucide-undo-2"
        variant="ghost"
        color="neutral"
        size="sm"
        @click="reset()"
      />
    </div>

    <!-- Actions -->
    <div class="flex justify-end gap-2">
      <UButton
        color="neutral"
        variant="ghost"
        @click="emit('cancel')"
      >
        {{ t('common.cancel') }}
      </UButton>
      <UButton
        color="primary"
        :loading="processing"
        @click="handleConfirm"
      >
        {{ t('image.cropApply') }}
      </UButton>
    </div>
  </div>
</template>

<style>
.crop-container cropper-canvas {
  width: 100% !important;
  height: 400px !important;
}
</style>
