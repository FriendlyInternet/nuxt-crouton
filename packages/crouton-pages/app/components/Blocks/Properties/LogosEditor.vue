<script setup lang="ts">
/**
 * Logos Editor
 *
 * Editor for managing logo items in logo blocks.
 * Each item can be an icon (icon name input) or an image (upload/browse/URL).
 * Supports drag-to-reorder and optional link per item.
 */
import type { LogoItem, LogoItemType } from '../../../types/blocks'
import Sortable from 'sortablejs'

interface InternalLogoItem extends LogoItem {
  _id: string
}

interface Props {
  modelValue: LogoItem[]
}

const props = defineProps<Props>()

const emit = defineEmits<{
  'update:modelValue': [value: LogoItem[]]
}>()

// Detect if crouton-assets is installed
const { hasApp } = useCroutonApps()
const hasAssetsPicker = hasApp('assets')
const { t } = useT()

// Internal ID counter for stable v-for keys
let nextId = 0
function assignId(item: LogoItem): InternalLogoItem {
  return { ...item, _id: `logo-${nextId++}` }
}

function stripId(item: InternalLogoItem): LogoItem {
  const { _id, ...rest } = item
  return rest
}

const items = ref<InternalLogoItem[]>(props.modelValue.map(assignId))

// Track which image items are in upload/browse/url mode
const imageMode = ref<Record<string, 'preview' | 'upload' | 'browse' | 'url'>>({})

// Store previous values when switching types so toggling back preserves them
const savedValues = ref<Record<string, { icon?: string, image?: string, imageAlt?: string }>>({})

// Drag-to-reorder using Sortable.js directly
const containerRef = ref<HTMLElement>()
const isReordering = ref(false)
let sortableInstance: Sortable | null = null

onMounted(() => {
  if (containerRef.value) {
    sortableInstance = Sortable.create(containerRef.value, {
      animation: 200,
      handle: '.drag-handle',
      ghostClass: 'opacity-50',
      // Revert DOM changes — let Vue handle rendering via reactive data
      onEnd: (event) => {
        const { oldIndex, newIndex } = event
        if (oldIndex == null || newIndex == null || oldIndex === newIndex) return

        // Revert the DOM manipulation so Vue stays in control
        const parent = event.from
        const movedEl = event.item
        if (oldIndex < newIndex) {
          parent.insertBefore(movedEl, parent.children[oldIndex] ?? null)
        }
        else {
          parent.insertBefore(movedEl, parent.children[oldIndex + 1] ?? null)
        }

        // Now reorder the reactive array
        isReordering.value = true
        const reordered = [...items.value]
        const [moved] = reordered.splice(oldIndex, 1)
        reordered.splice(newIndex, 0, moved!)
        items.value = reordered
        emit('update:modelValue', reordered.map(stripId))
        nextTick(() => { isReordering.value = false })
      }
    })
  }
})

onBeforeUnmount(() => {
  sortableInstance?.destroy()
})

watch(() => props.modelValue, (newVal: LogoItem[]) => {
  if (isReordering.value) return
  items.value = newVal.map(assignId)
}, { deep: true })

function emitChange() {
  emit('update:modelValue', items.value.map(stripId))
}

/** Resolve the effective type: explicit type field, or infer from value prefix */
function resolveType(item: LogoItem): LogoItemType {
  if (item.type) return item.type
  return item.value?.startsWith('i-') ? 'icon' : 'icon'
}

function addIconItem() {
  items.value.push(assignId({ type: 'icon', value: 'i-simple-icons-github' }))
  emitChange()
}

function addImageItem() {
  const newItem = assignId({ type: 'image', value: '' })
  items.value.push(newItem)
  imageMode.value[newItem._id] = hasAssetsPicker ? 'browse' : 'upload'
  emitChange()
}

function removeItem(index: number) {
  const id = items.value[index]!._id
  items.value.splice(index, 1)
  delete imageMode.value[id]
  delete savedValues.value[id]
  emitChange()
}

function updateItem(index: number, field: keyof LogoItem, value: string) {
  const item = items.value[index]!
  items.value[index] = { ...item, [field]: value } as InternalLogoItem
  emitChange()
}

function switchItemType(index: number, newType: LogoItemType) {
  const current = items.value[index]!
  const id = current._id
  const currentType = resolveType(current)

  // Save current value before switching
  if (!savedValues.value[id]) savedValues.value[id] = {}
  if (currentType === 'icon' && current.value) {
    savedValues.value[id]!.icon = current.value
  }
  else if (currentType === 'image' && current.value) {
    savedValues.value[id]!.image = current.value
    savedValues.value[id]!.imageAlt = current.alt
  }

  // Restore saved value for the new type, or start empty
  const saved = savedValues.value[id]
  if (newType === 'icon') {
    items.value[index] = {
      ...current,
      type: 'icon' as const,
      value: saved?.icon || '',
      alt: ''
    }
    delete imageMode.value[id]
  }
  else {
    const restoredValue = saved?.image || ''
    items.value[index] = {
      ...current,
      type: 'image' as const,
      value: restoredValue,
      alt: saved?.imageAlt || ''
    }
    imageMode.value[id] = restoredValue ? 'preview' : (hasAssetsPicker ? 'browse' : 'upload')
  }
  emitChange()
}

function isIcon(item: LogoItem): boolean {
  return resolveType(item) === 'icon'
}

// Image handling (mirrors ImageEditor.vue patterns)
function handleFileSelected(index: number, file: File | null) {
  if (!file) return
  const item = items.value[index]!
  const id = item._id
  const formData = new FormData()
  formData.append('file', file)

  $fetch<any>('/api/upload-image', {
    method: 'POST',
    body: formData
  }).then((result: { pathname: string }) => {
    const imageUrl = `/images/${result.pathname}`
    items.value[index] = { ...item, value: imageUrl }
    imageMode.value[id] = 'preview'
    emitChange()
  }).catch((err: unknown) => {
    console.error('Image upload failed:', err)
  })
}

function handleAssetSelected(index: number, asset: Record<string, any>) {
  const item = items.value[index]!
  const id = item._id
  const url = `/images/${asset.pathname}`
  items.value[index] = {
    ...item,
    value: url,
    alt: (asset.alt as string) || item.alt || ''
  }
  imageMode.value[id] = 'preview'
  emitChange()
}

function applyUrl(index: number, url: string) {
  const item = items.value[index]!
  const id = item._id
  items.value[index] = { ...item, value: url }
  imageMode.value[id] = 'preview'
  emitChange()
}

function removeImage(index: number) {
  const item = items.value[index]!
  const id = item._id
  items.value[index] = { ...item, value: '' }
  imageMode.value[id] = hasAssetsPicker ? 'browse' : 'upload'
  emitChange()
}

function getImageMode(index: number): string {
  const id = items.value[index]?._id
  if (id && imageMode.value[id]) return imageMode.value[id]
  return items.value[index]?.value ? 'preview' : (hasAssetsPicker ? 'browse' : 'upload')
}
</script>

<template>
  <div class="logos-editor space-y-2">
    <div ref="containerRef" class="space-y-2">
      <div
        v-for="(item, index) in items"
        :key="item._id"
        class="p-2 border border-default rounded-lg space-y-2"
      >
        <!-- Item Header: drag handle + type toggle + actions -->
        <div class="flex items-center justify-between">
          <div class="flex items-center gap-1">
            <!-- Drag handle -->
            <UIcon
              name="i-lucide-grip-vertical"
              class="drag-handle size-4 text-muted cursor-grab active:cursor-grabbing"
            />
            <!-- Type toggle buttons -->
            <UButtonGroup size="xs">
              <UButton
                :color="isIcon(item) ? 'primary' : 'neutral'"
                :variant="isIcon(item) ? 'solid' : 'ghost'"
                icon="i-lucide-at-sign"
                :label="t('pages.blocks.logos.typeIcon')"
                @click="isIcon(item) ? undefined : switchItemType(index, 'icon')"
              />
              <UButton
                :color="!isIcon(item) ? 'primary' : 'neutral'"
                :variant="!isIcon(item) ? 'solid' : 'ghost'"
                icon="i-lucide-image"
                :label="t('pages.blocks.logos.typeImage')"
                @click="!isIcon(item) ? undefined : switchItemType(index, 'image')"
              />
            </UButtonGroup>
          </div>

          <!-- Delete -->
          <UButton
            color="error"
            variant="ghost"
            icon="i-lucide-trash-2"
            size="xs"
            @click="removeItem(index)"
          />
        </div>

        <!-- Icon mode: icon picker -->
        <div v-if="isIcon(item)">
          <CroutonIconPicker
            :model-value="item.value || ''"
            size="sm"
            :collections="['simple-icons', 'lucide']"
            @update:model-value="updateItem(index, 'value', $event)"
          />
        </div>

        <!-- Image mode: upload / browse / URL with preview -->
        <div v-else class="space-y-2">
          <!-- Image Preview -->
          <div v-if="item.value && getImageMode(index) === 'preview'" class="space-y-2">
            <div class="relative rounded-lg overflow-hidden border border-default">
              <img
                :src="item.value"
                :alt="item.alt || ''"
                class="w-full max-h-24 object-contain bg-muted/20"
              >
              <div class="absolute top-1 right-1 flex gap-1">
                <UButton
                  icon="i-lucide-pencil"
                  color="neutral"
                  variant="solid"
                  size="xs"
                  @click="imageMode[item._id] = 'url'"
                />
                <UButton
                  icon="i-lucide-trash-2"
                  color="error"
                  variant="solid"
                  size="xs"
                  @click="removeImage(index)"
                />
              </div>
            </div>
            <UInput
              :model-value="item.alt || ''"
              :placeholder="t('pages.blocks.altText')"
              size="sm"
              class="w-full"
              @update:model-value="updateItem(index, 'alt', $event)"
            />
          </div>

          <!-- No Image: action buttons -->
          <div v-if="!item.value && getImageMode(index) === 'preview'" class="flex flex-col gap-2">
            <div class="flex items-center justify-center h-16 rounded-lg border-2 border-dashed border-default bg-muted">
              <div class="text-center">
                <UIcon name="i-lucide-image" class="size-5 text-dimmed" />
                <p class="text-xs text-muted">{{ t('pages.blocks.logos.noImage') }}</p>
              </div>
            </div>
            <div class="flex gap-1">
              <UButton
                v-if="hasAssetsPicker"
                icon="i-lucide-folder-open"
                :label="t('pages.blocks.media.browse')"
                variant="soft"
                color="neutral"
                size="xs"
                class="flex-1"
                @click="imageMode[item._id] = 'browse'"
              />
              <UButton
                icon="i-lucide-upload"
                :label="t('pages.blocks.media.upload')"
                variant="soft"
                color="neutral"
                size="xs"
                class="flex-1"
                @click="imageMode[item._id] = 'upload'"
              />
              <UButton
                icon="i-lucide-link"
                :label="t('pages.blocks.urlLabel')"
                variant="soft"
                color="neutral"
                size="xs"
                class="flex-1"
                @click="imageMode[item._id] = 'url'"
              />
            </div>
          </div>

          <!-- Browse Library -->
          <div v-if="getImageMode(index) === 'browse' && hasAssetsPicker" class="space-y-2">
            <Suspense>
              <CroutonAssetsPicker @select="handleAssetSelected(index, $event)" />
              <template #fallback>
                <div class="h-16 flex items-center justify-center text-xs text-muted">{{ t('pages.blocks.media.loadingLibrary') }}</div>
              </template>
            </Suspense>
            <div class="flex gap-1">
              <UButton icon="i-lucide-upload" :label="t('pages.blocks.media.upload')" variant="ghost" color="neutral" size="xs" @click="imageMode[item._id] = 'upload'" />
              <UButton icon="i-lucide-link" :label="t('pages.blocks.urlLabel')" variant="ghost" color="neutral" size="xs" @click="imageMode[item._id] = 'url'" />
              <UButton v-if="item.value" :label="t('common.cancel')" variant="ghost" color="neutral" size="xs" @click="imageMode[item._id] = 'preview'" />
            </div>
          </div>

          <!-- Upload -->
          <div v-if="getImageMode(index) === 'upload'" class="space-y-2">
            <CroutonImageUpload @file-selected="handleFileSelected(index, $event)" />
            <div class="flex gap-1">
              <UButton v-if="hasAssetsPicker" icon="i-lucide-folder-open" :label="t('pages.blocks.media.browse')" variant="ghost" color="neutral" size="xs" @click="imageMode[item._id] = 'browse'" />
              <UButton icon="i-lucide-link" :label="t('pages.blocks.urlLabel')" variant="ghost" color="neutral" size="xs" @click="imageMode[item._id] = 'url'" />
              <UButton v-if="item.value" :label="t('common.cancel')" variant="ghost" color="neutral" size="xs" @click="imageMode[item._id] = 'preview'" />
            </div>
          </div>

          <!-- URL Input -->
          <div v-if="getImageMode(index) === 'url'" class="space-y-2">
            <UInput
              :model-value="item.value"
              placeholder="https://example.com/logo.png"
              size="sm"
              @update:model-value="updateItem(index, 'value', $event)"
            >
              <template #leading>
                <UIcon name="i-lucide-link" class="size-4" />
              </template>
            </UInput>
            <div class="flex gap-1">
              <UButton :label="t('common.apply')" color="primary" size="xs" @click="applyUrl(index, item.value)" />
              <UButton v-if="hasAssetsPicker" icon="i-lucide-folder-open" :label="t('pages.blocks.media.browse')" variant="ghost" color="neutral" size="xs" @click="imageMode[item._id] = 'browse'" />
              <UButton icon="i-lucide-upload" :label="t('pages.blocks.media.upload')" variant="ghost" color="neutral" size="xs" @click="imageMode[item._id] = 'upload'" />
              <UButton v-if="item.value" :label="t('common.cancel')" variant="ghost" color="neutral" size="xs" @click="imageMode[item._id] = 'preview'" />
            </div>
          </div>
        </div>

        <!-- Link input (shared by both icon and image modes) -->
        <UInput
          :model-value="item.link || ''"
          placeholder="https://example.com (optional link)"
          size="sm"
          class="w-full"
          @update:model-value="updateItem(index, 'link', $event)"
        >
          <template #leading>
            <UIcon name="i-lucide-external-link" class="size-4 text-muted" />
          </template>
        </UInput>
      </div>
    </div>

    <!-- Add buttons -->
    <div class="flex gap-2">
      <UButton
        color="neutral"
        variant="outline"
        icon="i-lucide-at-sign"
        size="sm"
        class="flex-1"
        @click="addIconItem"
      >
        {{ t('pages.blocks.logos.addIcon') }}
      </UButton>
      <UButton
        color="neutral"
        variant="outline"
        icon="i-lucide-image"
        size="sm"
        class="flex-1"
        @click="addImageItem"
      >
        {{ t('pages.blocks.logos.addImage') }}
      </UButton>
    </div>
  </div>
</template>
