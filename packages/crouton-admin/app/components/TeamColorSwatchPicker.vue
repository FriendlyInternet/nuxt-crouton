<script setup lang="ts">
/**
 * Color Swatch Picker Component
 *
 * A grid of color swatches for selecting primary/neutral colors.
 * Tailwind color names are mapped to their 500 shade for display.
 *
 * Deliberately a custom widget (#1410): a color-swatch grid has no Nuxt UI
 * equivalent — each cell's background IS the data, so themes shouldn't
 * restyle it. Chrome around it uses semantic tokens.
 *
 * @example
 * ```vue
 * <TeamColorSwatchPicker
 *   v-model="primaryColor"
 *   :colors="PRIMARY_COLORS"
 *   label="Primary Color"
 * />
 * ```
 */
import { computed } from 'vue'

interface Props {
  /** Selected color value */
  modelValue?: string
  /** Available colors to choose from */
  colors: string[]
  /** Label for the picker */
  label?: string
  /** Disable interaction */
  disabled?: boolean
  /** Size of color swatches */
  size?: 'sm' | 'md' | 'lg'
}

const props = withDefaults(defineProps<Props>(), {
  modelValue: undefined,
  label: undefined,
  disabled: false,
  size: 'md'
})

const emit = defineEmits<{
  'update:modelValue': [value: string]
}>()

// Tailwind color shades for display
// Primary colors use 500, neutral colors use 900 (more representative of dark UI)
const COLOR_HEX_MAP: Record<string, string> = {
  // Primary colors (500 shade)
  red: '#ef4444',
  orange: '#f97316',
  amber: '#f59e0b',
  yellow: '#eab308',
  lime: '#84cc16',
  green: '#22c55e',
  emerald: '#10b981',
  teal: '#14b8a6',
  cyan: '#06b6d4',
  sky: '#0ea5e9',
  blue: '#3b82f6',
  indigo: '#6366f1',
  violet: '#8b5cf6',
  purple: '#a855f7',
  fuchsia: '#d946ef',
  pink: '#ec4899',
  rose: '#f43f5e',
  // Neutral colors (500 shade - visible in both light/dark modes)
  slate: '#64748b',
  gray: '#6b7280',
  zinc: '#71717a',
  neutral: '#737373',
  stone: '#78716c'
}

// Size classes for swatches
const sizeClasses = {
  sm: 'size-6',
  md: 'size-8',
  lg: 'size-10'
}

const swatchSize = computed(() => sizeClasses[props.size])

function selectColor(color: string) {
  if (!props.disabled) {
    emit('update:modelValue', color)
  }
}

function getColorHex(color: string): string {
  return COLOR_HEX_MAP[color] ?? '#888888'
}
</script>

<template>
  <div class="space-y-2">
    <label v-if="label" class="text-sm font-medium text-default">
      {{ label }}
    </label>
    <div class="flex flex-wrap gap-2">
      <button
        v-for="color in colors"
        :key="color"
        type="button"
        :disabled="disabled"
        :title="color"
        class="rounded-full transition-all duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2"
        :class="[
          swatchSize,
          modelValue === color
            ? 'ring-2 ring-offset-2 ring-primary-500 scale-110'
            : 'hover:scale-105',
          disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'
        ]"
        :style="{ backgroundColor: getColorHex(color) }"
        @click="selectColor(color)"
      >
        <span class="sr-only">{{ color }}</span>
        <UIcon
          v-if="modelValue === color"
          name="i-lucide-check"
          class="size-4 text-white drop-shadow-sm mx-auto"
        />
      </button>
    </div>
  </div>
</template>
