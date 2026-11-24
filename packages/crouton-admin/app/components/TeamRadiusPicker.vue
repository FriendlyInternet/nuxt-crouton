<script setup lang="ts">
/**
 * Radius Picker Component
 *
 * A button group for selecting border radius values with visual preview.
 *
 * Deliberately a custom widget (#1410): each option previews its own literal
 * radius — a themed UButton would repaint the previews with the theme's
 * radius and destroy the comparison. Chrome uses semantic tokens.
 *
 * @example
 * ```vue
 * <TeamRadiusPicker v-model="radius" :label="`Corners · Soft`" />
 * ```
 *
 * `label` overrides the heading (default: the translated "Corners").
 */
import { RADIUS_OPTIONS, type ThemeRadius } from '../composables/useTeamTheme'
import { radiusLabel } from '../utils/theme-picker'

interface Props {
  /** Selected radius value */
  modelValue?: ThemeRadius
  /** Disable interaction */
  disabled?: boolean
  /** Heading text (defaults to the translated "Corners") */
  label?: string
}

const props = withDefaults(defineProps<Props>(), {
  modelValue: 0.25,
  disabled: false,
  label: undefined
})

const emit = defineEmits<{
  'update:modelValue': [value: ThemeRadius]
}>()

// Available radius options with labels
const { t } = useT()

const radiusOptions = computed<{ value: ThemeRadius; label: string }[]>(() =>
  RADIUS_OPTIONS.map(value => ({ value, label: radiusLabel(value, t) }))
)

function selectRadius(radius: ThemeRadius) {
  if (!props.disabled) {
    emit('update:modelValue', radius)
  }
}
</script>

<template>
  <div class="space-y-2">
    <label class="text-sm font-medium text-default">
      {{ label ?? t('themeSettings.corners') }}
    </label>
    <div class="flex flex-wrap gap-2">
      <button
        v-for="option in radiusOptions"
        :key="option.value"
        type="button"
        :disabled="disabled"
        class="flex flex-col items-center gap-1.5 p-2 border transition-all duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
        :class="[
          modelValue === option.value
            ? 'border-primary-500 bg-primary-50 dark:bg-primary-950'
            : 'border-muted hover:border-default',
          disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'
        ]"
        :style="{ borderRadius: `${option.value}rem` }"
        @click="selectRadius(option.value)"
      >
        <!-- Visual preview square -->
        <div
          class="size-8 bg-primary-500"
          :style="{ borderRadius: `${option.value * 2}rem` }"
        />
        <span class="text-xs font-medium text-muted">
          {{ option.label }}
        </span>
      </button>
    </div>
  </div>
</template>
