<script setup lang="ts">
interface Props {
  modelValue?: string
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl'
  presets?: string[]
  placeholder?: string
}

const props = withDefaults(defineProps<Props>(), {
  modelValue: '#FFFFFF',
  size: 'md',
  placeholder: 'Pick a color'
})

const emit = defineEmits<{
  'update:modelValue': [value: string]
}>()

const TAILWIND_PRESETS = [
  '#ef4444', '#f97316', '#f59e0b', '#eab308',
  '#84cc16', '#22c55e', '#10b981', '#14b8a6',
  '#06b6d4', '#0ea5e9', '#3b82f6', '#6366f1',
  '#8b5cf6', '#a855f7', '#d946ef', '#ec4899'
]

const presetColors = computed(() => props.presets ?? TAILWIND_PRESETS)

const open = ref(false)
const showCustom = ref(false)

const color = computed({
  get: () => props.modelValue || '#FFFFFF',
  set: (value: string) => emit('update:modelValue', value)
})

const hexInput = ref(color.value)

watch(color, (val) => {
  hexInput.value = val
})

const applyHex = () => {
  let val = hexInput.value.trim()
  if (!val.startsWith('#')) val = `#${val}`
  if (/^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})$/.test(val)) {
    color.value = val
  } else {
    hexInput.value = color.value
  }
}

const selectPreset = (hex: string) => {
  color.value = hex
  showCustom.value = false
  open.value = false
}

const clear = () => {
  emit('update:modelValue', '')
  open.value = false
}

const hasValue = computed(() => !!props.modelValue && props.modelValue !== '')
</script>

<template>
  <UPopover v-model:open="open">
    <UButton
      color="neutral"
      variant="outline"
      :size="size"
      class="justify-start"
    >
      <template #leading>
        <span
          class="size-4 rounded-full border border-gray-300 dark:border-gray-600 shrink-0"
          :style="{ backgroundColor: hasValue ? color : 'transparent' }"
        />
      </template>
      <span class="font-mono text-sm" :class="{ 'text-muted': !hasValue }">
        {{ hasValue ? color : placeholder }}
      </span>
      <template v-if="hasValue" #trailing>
        <UButton
          color="neutral"
          variant="ghost"
          size="xs"
          icon="i-lucide-x"
          class="-mr-1.5"
          @click.stop="clear"
        />
      </template>
    </UButton>

    <template #content>
      <div class="p-3 w-64">
        <!-- Preset swatches: deliberately a custom widget — a color-swatch
             grid has no Nuxt UI equivalent; selection uses semantic primary
             tokens so themes still reach it (#1410) -->
        <div class="grid grid-cols-8 gap-1.5">
          <button
            v-for="hex in presetColors"
            :key="hex"
            type="button"
            class="size-6 rounded-full border-2 transition-transform hover:scale-110 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            :class="color.toLowerCase() === hex.toLowerCase() ? 'border-primary ring-1 ring-primary' : 'border-transparent'"
            :style="{ backgroundColor: hex }"
            @click="selectPreset(hex)"
          />
        </div>

        <USeparator class="my-3" />

        <!-- Custom toggle — UButton so themes reach it (#1410) -->
        <UButton
          color="neutral"
          variant="ghost"
          size="sm"
          :icon="showCustom ? 'i-lucide-chevron-down' : 'i-lucide-chevron-right'"
          class="w-full justify-start mb-2 text-sm text-muted hover:text-highlighted"
          @click="showCustom = !showCustom"
        >
          Custom color
        </UButton>

        <!-- Custom picker -->
        <div v-if="showCustom" class="mb-3">
          <UColorPicker v-model="color" size="sm" />
        </div>

        <!-- Hex input -->
        <UInput
          v-model="hexInput"
          class="w-full font-mono text-sm"
          size="sm"
          placeholder="#000000"
          @blur="applyHex"
          @keydown.enter="applyHex"
        />
      </div>
    </template>
  </UPopover>
</template>
