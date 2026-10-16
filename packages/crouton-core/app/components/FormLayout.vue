<script setup lang="ts">
interface NavigationItem {
  label: string
  value: string
  icon?: string
}

interface Props {
  tabs?: boolean
  navigationItems?: NavigationItem[]
  tabErrors?: Record<string, number>
  modelValue?: string
}

const props = withDefaults(defineProps<Props>(), {
  tabs: false,
  navigationItems: () => [],
  tabErrors: () => ({}),
  modelValue: ''
})

const emit = defineEmits<{
  'update:modelValue': [value: string]
}>()

// Two-way binding for active section
const activeSection = computed({
  get: () => props.modelValue || props.navigationItems?.[0]?.value || '',
  set: value => emit('update:modelValue', value)
})

// Enhance navigation items with error indicators
// Many tabs don't fit a phone: show icons only below `sm` (labels stay for
// screen readers). Only when every tab has an icon, so none renders empty.
const tabsIconOnlyOnMobile = computed(() =>
  props.navigationItems.length > 3 && props.navigationItems.every(item => item.icon)
)

const enhancedNavigationItems = computed(() => {
  return props.navigationItems.map((item) => {
    const errorCount = props.tabErrors[item.value] || 0

    if (errorCount > 0) {
      return {
        ...item,
        // Add red error badge
        badge: {
          color: 'red' as const,
          variant: 'solid' as const,
          // Use a dot or the error count
          label: '●'
        }
      }
    }

    return item
  })
})

// Detect if sidebar slot is being used
const { t } = useT()
const slots = useSlots()
const hasSidebar = computed(() => !!slots.sidebar)

// Prepare accordion items for mobile sidebar
const sidebarAccordionItems = computed(() => [{
  label: t('form.metaSettings'),
  defaultOpen: false
}])
</script>

<template>
  <div class="flex flex-col h-full max-w-7xl mx-auto">
    <!-- Header Slot -->
    <div
      v-if="$slots.header"
      class="mb-6 "
    >
      <slot name="header" />
    </div>
    <!-- Main Container with responsive max-width -->
    <div
      class="flex flex-col gap-6 w-full mx-auto flex-grow "
    >
      <!-- Grid Container (only when sidebar exists) -->
      <div :class="hasSidebar ? '@container grid grid-cols-1 @lg:grid-cols-3 gap-6' : 'flex flex-col flex-1 min-h-0'">
        <!-- Main Area -->
        <div :class="hasSidebar ? '@lg:col-span-2 space-y-6' : 'flex-1 flex flex-col gap-6 min-h-0'">
          <!-- Tab Navigation (optional) -->

          <UTabs
            v-if="tabs && navigationItems.length"
            v-model="activeSection"
            :items="enhancedNavigationItems as any"
            :content="false"
            :ui="tabsIconOnlyOnMobile ? { label: 'sr-only sm:not-sr-only' } : undefined"
            class="w-full"
          />
          <!-- Main Content Slot -->
          <slot
            class="p"
            name="main"
            :active-section="activeSection"
          />

          <!-- Mobile / Small area: Accordion at top (only when sidebar exists) -->
          <div
            v-if="hasSidebar"
            class="@lg:hidden mb-6"
            :ui="{ body: 'sm:p-4 ' }"
          >
            <UAccordion :items="sidebarAccordionItems">
              <template #content="{ item }">
                <div class="">
                  <slot name="sidebar" />
                </div>
              </template>
            </UAccordion>
          </div>
        </div>

        <!-- Sidebar Area (responsive: column on desktop, accordion on mobile) -->
        <div
          v-if="hasSidebar"
          class="@lg:col-span-1"
        >
          <!-- Desktop: Regular sidebar column -->
          <div class="hidden @lg:block space-y-6">
            <slot name="sidebar" />
          </div>
        </div>
      </div>
    </div>
    <!-- Footer Slot -->
    <div v-if="$slots.footer" class="py-6">
      <slot name="footer" />
    </div>
  </div>
</template>
