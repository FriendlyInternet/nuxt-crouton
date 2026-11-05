<script setup lang="ts">
/**
 * Gallery Items Editor
 *
 * Editor for managing image items in gallery blocks.
 * Each item has an image source (via ImageEditor) and optional alt text.
 */
import type { GalleryItem } from '../../../types/blocks'

interface Props {
  modelValue: GalleryItem[]
}

const props = defineProps<Props>()
const { t } = useT()

const emit = defineEmits<{
  'update:modelValue': [value: GalleryItem[]]
}>()

const images = ref<GalleryItem[]>([...props.modelValue])

watch(() => props.modelValue, (newVal) => {
  images.value = [...newVal]
}, { deep: true })

function emitChange() {
  emit('update:modelValue', [...images.value])
}

function addImage() {
  images.value.push({
    src: '',
    alt: ''
  })
  emitChange()
}

function removeImage(index: number) {
  images.value.splice(index, 1)
  emitChange()
}

function updateImage(index: number, field: keyof GalleryItem, value: string) {
  images.value[index] = { ...images.value[index], [field]: value } as GalleryItem
  emitChange()
}

function moveImage(index: number, direction: 'up' | 'down') {
  const newIndex = direction === 'up' ? index - 1 : index + 1
  if (newIndex < 0 || newIndex >= images.value.length) return

  const temp = images.value[index]!
  images.value[index] = images.value[newIndex]!
  images.value[newIndex] = temp
  emitChange()
}
</script>

<template>
  <div class="gallery-editor space-y-3">
    <div
      v-for="(image, index) in images"
      :key="index"
      class="p-3 border border-default rounded-lg space-y-2"
    >
      <!-- Header with move/delete -->
      <div class="flex items-center justify-between">
        <span class="text-sm font-medium">{{ t('pages.blockEditors.imageN', { n: index + 1 }) }}</span>
        <div class="flex items-center gap-1">
          <UButton
            color="neutral"
            variant="ghost"
            icon="i-lucide-chevron-up"
            size="xs"
            :disabled="index === 0"
            @click="moveImage(index, 'up')"
          />
          <UButton
            color="neutral"
            variant="ghost"
            icon="i-lucide-chevron-down"
            size="xs"
            :disabled="index === images.length - 1"
            @click="moveImage(index, 'down')"
          />
          <UButton
            color="error"
            variant="ghost"
            icon="i-lucide-trash-2"
            size="xs"
            @click="removeImage(index)"
          />
        </div>
      </div>

      <!-- Image picker (reuses the existing ImageEditor) -->
      <CroutonPagesBlocksPropertiesImageEditor
        :model-value="image.src"
        @update:model-value="updateImage(index, 'src', $event)"
        @update:alt="updateImage(index, 'alt', $event)"
      />

      <!-- Alt text -->
      <UInput
        :model-value="image.alt || ''"
        :placeholder="t('pages.blockEditors.altPlaceholder')"
        size="sm"
        @update:model-value="updateImage(index, 'alt', $event)"
      />
    </div>

    <!-- Add Button -->
    <UButton
      color="neutral"
      variant="outline"
      icon="i-lucide-plus"
      size="sm"
      block
      @click="addImage"
    >
      {{ t('pages.blockEditors.addImage') }}
    </UButton>
  </div>
</template>
