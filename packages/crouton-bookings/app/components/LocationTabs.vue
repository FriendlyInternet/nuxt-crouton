<script setup lang="ts">
import { computed, watch, useTemplateRef } from 'vue'
import type { LocationData } from '../types/booking'
import { ALL_LOCATIONS } from '../utils/location-tabs'

/**
 * One sideways-scrolling row of location tabs (#4471), shared by the bookings
 * panel and the booking form. Optional "All" first, an admin "+" after the row
 * (never a tab, so never the active one). With one location no tabs show —
 * only the "+" when `canAdd`.
 */
interface Props {
  locations: LocationData[]
  /** Selected location id; `null` = All */
  modelValue: string | null
  /** Put an "All" tab first (value `null`) */
  showAll?: boolean
  /** Show a "+" after the row that emits `add` */
  canAdd?: boolean
  /** Locations that can't be picked (dimmed, disabled) */
  isDisabled?: (id: string) => boolean
}

const props = withDefaults(defineProps<Props>(), {
  showAll: false,
  canAdd: false,
  isDisabled: undefined,
})

const emit = defineEmits<{
  'update:modelValue': [value: string | null]
  add: []
}>()

const { t } = useT()
const { locale } = useI18n()

// Localized location title with fallbacks
function getLocationTitle(location: LocationData): string {
  const translations = location.translations as Record<string, { title?: string }> | undefined
  return translations?.[locale.value]?.title
    || translations?.en?.title
    || location.title
    || t('bookings.untitled')
}

interface LocationTab {
  value: string
  label: string
  disabled?: boolean
  /** The coloured dot; the "All" tab has none */
  color?: string
  ui?: { trigger: string }
}

const items = computed<LocationTab[]>(() => {
  const tabs = props.locations.map((l): LocationTab => {
    const disabled = props.isDisabled?.(l.id) ?? false
    return {
      value: l.id,
      label: getLocationTitle(l),
      disabled,
      color: disabled ? '#9ca3af' : (l.color || '#3b82f6'),
      ui: { trigger: disabled ? 'opacity-40' : '' },
    }
  })
  return props.showAll
    ? [{ value: ALL_LOCATIONS, label: t('bookings.filters.all') }, ...tabs]
    : tabs
})

const boundValue = computed(() => props.modelValue ?? (props.showAll ? ALL_LOCATIONS : undefined))

function onUpdate(v: string | number) {
  emit('update:modelValue', v === ALL_LOCATIONS ? null : String(v))
}

// The selected tab is brought into view (as CroutonTabsPanel does)
const tabsWrap = useTemplateRef<HTMLElement>('tabsWrap')
function revealActiveTab() {
  const active = tabsWrap.value?.querySelector<HTMLElement>('[data-state="active"]')
    ?? tabsWrap.value?.querySelector<HTMLElement>('[aria-selected="true"]')
  active?.scrollIntoView({ inline: 'nearest', block: 'nearest' })
}
useResizeObserver(tabsWrap, revealActiveTab)
watch(() => props.modelValue, revealActiveTab, { flush: 'post' })
</script>

<template>
  <div v-if="locations.length > 1 || canAdd" class="flex items-center gap-1">
    <div v-if="locations.length > 1" ref="tabsWrap" class="min-w-0 flex-1">
      <UTabs
        :items="items"
        :model-value="boundValue"
        :content="false"
        variant="link"
        size="sm"
        :ui="{ list: SCROLL_ROW_X, trigger: 'min-w-fit' }"
        @update:model-value="onUpdate"
      >
        <template #leading="{ item }">
          <span
            v-if="item.color"
            class="w-2 h-2 rounded-full shrink-0"
            :style="{ backgroundColor: item.color }"
          />
        </template>
      </UTabs>
    </div>
    <UButton
      v-if="canAdd"
      icon="i-lucide-plus"
      size="xs"
      variant="ghost"
      color="neutral"
      class="shrink-0 ms-auto"
      :aria-label="t('bookings.filters.addLocation')"
      @click="emit('add')"
    />
  </div>
</template>
