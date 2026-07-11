<script setup lang="ts">
/**
 * Video property editor for block editor.
 * Three modes: browse assets (if crouton-assets installed), upload new, paste URL.
 * Follows ImageEditor.vue pattern with modelValue + update:modelValue.
 */
import { useFileDialog } from '@vueuse/core'

interface Props {
  modelValue: string
}

const props = defineProps<Props>()

const emit = defineEmits<{
  'update:modelValue': [value: string]
}>()

// Detect if crouton-assets is installed via the croutonApps registry
const { hasApp } = useCroutonApps()
const hasAssetsPicker = hasApp('assets')

type Mode = 'preview' | 'url' | 'upload' | 'browse' | 'bunny'
const mode = ref<Mode>(hasAssetsPicker && !props.modelValue ? 'browse' : 'preview')
const urlInput = ref(props.modelValue || '')
const bunnyInput = ref('')
const uploading = ref(false)

/** Detect if a URL is a Bunny Stream embed or CDN URL */
function isBunnyUrl(url: string): boolean {
  return /iframe\.mediadelivery\.net/.test(url) || /\.b-cdn\.net/.test(url)
}

/** Normalize a Bunny URL for rendering: /play/ → /embed/, add responsive=true */
function toBunnyEmbed(url: string): string {
  let out = url.replace('/play/', '/embed/')
  if (!out.includes('responsive=')) {
    out += (out.includes('?') ? '&' : '?') + 'responsive=true'
  }
  return out
}

/**
 * Normalize a Bunny Stream input to an embed URL.
 * - Converts /play/ to /embed/ (Bunny's recommended embed path)
 * - Adds responsive=true so the player fills its iframe container
 */
function normalizeBunnyUrl(input: string): string {
  const trimmed = input.trim()
  if (!trimmed) return trimmed

  let url = trimmed
  // Convert /play/ to /embed/
  url = url.replace('/play/', '/embed/')

  // Ensure responsive=true is present
  if (url.includes('iframe.mediadelivery.net') && !url.includes('responsive=')) {
    url += (url.includes('?') ? '&' : '?') + 'responsive=true'
  }

  return url
}

function setBunnyUrl() {
  const url = normalizeBunnyUrl(bunnyInput.value)
  if (!url) return
  emit('update:modelValue', url)
  urlInput.value = url
  mode.value = 'preview'
}

// Sync local URL with props
watch(() => props.modelValue, (val) => {
  urlInput.value = val || ''
})

const { t } = useT()
const hasVideo = computed(() => !!props.modelValue)

function setUrl() {
  emit('update:modelValue', urlInput.value)
  mode.value = 'preview'
}

function removeVideo() {
  emit('update:modelValue', '')
  urlInput.value = ''
  mode.value = hasAssetsPicker ? 'browse' : 'preview'
}

// File dialog for video upload
const { files, open: openFilePicker, onChange } = useFileDialog({
  accept: 'video/*',
  multiple: false
})

onChange(() => {
  const file = files.value?.[0]
  if (!file) return
  handleFileUpload(file)
})

function handleFileUpload(file: File) {
  uploading.value = true
  const formData = new FormData()
  formData.append('file', file)

  $fetch<{ pathname: string }>('/api/upload-image', {
    method: 'POST',
    body: formData
  }).then((result) => {
    const videoUrl = `/images/${result.pathname}`
    emit('update:modelValue', videoUrl)
    urlInput.value = videoUrl
    mode.value = 'preview'
  }).catch((err) => {
    console.error('Video upload failed:', err)
  }).finally(() => {
    uploading.value = false
  })
}

function handleAssetSelected(asset: Record<string, any>) {
  const url = `/images/${asset.pathname}`
  emit('update:modelValue', url)
  urlInput.value = url
  mode.value = 'preview'
}
</script>

<template>
  <div class="space-y-3">
    <!-- Video Preview -->
    <div v-if="hasVideo && mode === 'preview'" class="space-y-2">
      <div class="relative rounded-lg overflow-hidden border border-default">
        <!-- Bunny Stream iframe preview -->
        <div v-if="isBunnyUrl(modelValue)" class="relative w-full" style="padding-bottom: 56.25%;">
          <iframe
            :src="toBunnyEmbed(modelValue)"
            class="absolute inset-0 w-full h-full"
            loading="lazy"
            allow="accelerometer;gyroscope;autoplay;encrypted-media;picture-in-picture;"
            allowfullscreen
            style="border: none;"
          />
        </div>
        <!-- Native video preview -->
        <video
          v-else
          :src="modelValue"
          muted
          class="w-full max-h-48 object-contain bg-black"
        />
        <div class="absolute top-2 right-2 flex gap-1">
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
            @click="removeVideo"
          />
        </div>
      </div>
    </div>

    <!-- No Video State — Browse tab shown first if available -->
    <div v-if="!hasVideo && mode === 'preview'" class="flex flex-col gap-2">
      <div class="flex items-center justify-center h-32 rounded-lg border-2 border-dashed border-default bg-muted">
        <div class="text-center">
          <UIcon name="i-lucide-video" class="size-8 text-dimmed mb-2" />
          <p class="text-sm text-muted">
            {{ t('pages.blocks.video.noVideoSet') }}
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
        <UButton
          icon="i-lucide-rabbit"
          :label="t('pages.blocks.video.bunnyStream')"
          variant="soft"
          color="neutral"
          size="xs"
          class="flex-1"
          @click="mode = 'bunny'"
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
          :label="t('pages.blocks.media.upload')"
          variant="ghost"
          color="neutral"
          size="xs"
          @click="mode = 'upload'"
        />
        <UButton
          icon="i-lucide-link"
          :label="t('pages.blocks.urlLabel')"
          variant="ghost"
          color="neutral"
          size="xs"
          @click="mode = 'url'"
        />
        <UButton
          icon="i-lucide-rabbit"
          :label="t('pages.blocks.video.bunnyStream')"
          variant="ghost"
          color="neutral"
          size="xs"
          @click="mode = 'bunny'"
        />
        <UButton
          v-if="hasVideo"
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
        placeholder="https://example.com/video.mp4 or /images/..."
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
          @click="mode = hasVideo ? 'preview' : (hasAssetsPicker ? 'browse' : 'preview')"
        />
        <UButton
          icon="i-lucide-rabbit"
          :label="t('pages.blocks.video.bunnyStream')"
          variant="ghost"
          color="neutral"
          size="xs"
          @click="mode = 'bunny'"
        />
      </div>
    </div>

    <!-- Upload Mode -->
    <div v-if="mode === 'upload'" class="space-y-2">
      <button
        type="button"
        class="flex h-32 w-full cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-default bg-muted hover:bg-elevated transition-colors"
        :disabled="uploading"
        @click="openFilePicker()"
      >
        <UIcon
          :name="uploading ? 'i-lucide-loader-2' : 'i-lucide-upload'"
          :class="['size-6 text-dimmed', { 'animate-spin': uploading }]"
        />
        <span class="text-sm text-muted">
          {{ uploading ? t('pages.blocks.media.uploading') : t('pages.blocks.video.clickToSelect') }}
        </span>
      </button>
      <div class="flex gap-2">
        <UButton
          :label="t('common.cancel')"
          variant="ghost"
          color="neutral"
          size="xs"
          @click="mode = hasVideo ? 'preview' : (hasAssetsPicker ? 'browse' : 'preview')"
        />
        <UButton
          v-if="hasAssetsPicker"
          icon="i-lucide-folder-open"
          :label="t('pages.blocks.media.browse')"
          variant="ghost"
          color="neutral"
          size="xs"
          @click="mode = 'browse'"
        />
        <UButton
          icon="i-lucide-rabbit"
          :label="t('pages.blocks.video.bunnyStream')"
          variant="ghost"
          color="neutral"
          size="xs"
          @click="mode = 'bunny'"
        />
      </div>
    </div>

    <!-- Bunny Stream Mode -->
    <div v-if="mode === 'bunny'" class="space-y-2">
      <div class="flex items-center gap-2 text-xs text-muted mb-1">
        <UIcon name="i-lucide-rabbit" class="size-3.5" />
        <span>{{ t('pages.blocks.video.bunnyStream') }}</span>
      </div>
      <UInput
        v-model="bunnyInput"
        placeholder="https://iframe.mediadelivery.net/play/..."
        size="sm"
        class="w-full"
      >
        <template #leading>
          <UIcon name="i-lucide-video" class="size-4" />
        </template>
      </UInput>
      <p class="text-[11px] text-muted leading-tight">
        {{ t('pages.blocks.video.bunnyInstructions') }}
      </p>
      <div class="flex gap-2">
        <UButton
          :label="t('common.apply')"
          color="primary"
          size="xs"
          :disabled="!bunnyInput.trim()"
          @click="setBunnyUrl"
        />
        <UButton
          :label="t('common.cancel')"
          variant="ghost"
          color="neutral"
          size="xs"
          @click="mode = hasVideo ? 'preview' : (hasAssetsPicker ? 'browse' : 'preview')"
        />
      </div>
    </div>
  </div>
</template>
