<template>
  <div class="flex items-center gap-2">
    <UAvatar
      :src="model || undefined"
      :size="avatarSize"
      icon="i-lucide-upload"
      :ui="{ icon: 'text-lg' }"
      class="ring-1 ring-neutral-200 dark:ring-neutral-800"
    />
    <UButton
      type="button"
      color="neutral"
      variant="soft"
      :label="model ? t('image.change') : t('image.upload')"
      size="xs"
      @click="() => open()"
    />
    <UButton
      v-if="model"
      type="button"
      color="error"
      variant="soft"
      :label="t('common.remove')"
      size="xs"
      @click="removeImage"
    />

    <!-- Crop Modal for avatars (1:1 circular) -->
    <UModal v-model:open="showCropper">
      <template #content="{ close }">
        <div class="p-6">
          <h3 class="text-lg font-semibold mb-4">
            {{ t('image.cropAvatar') }}
          </h3>
          <CroutonImageCropper
            v-if="pendingFile"
            :file="pendingFile"
            aspect-ratio="1:1"
            circular
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

const { t } = useT()

withDefaults(
  defineProps<{
    avatarSize?: 'xs' | 'sm' | 'md' | 'lg' | 'xl' | '2xl' | '3xl'
  }>(),
  {
    avatarSize: '3xl'
  }
)

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

onChange(() => {
  const file = files.value?.[0]
  if (file) {
    pendingFile.value = file
    showCropper.value = true
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
  model.value = ''
  emit('file-selected', null)
}
</script>
