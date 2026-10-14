<template>
  <div class="text-center py-12 px-4" role="status" aria-live="polite">
    <!-- Icon Circle -->
    <div class="w-16 h-16 sm:w-20 sm:h-20 rounded-full flex items-center justify-center mx-auto mb-4 transition-colors"
         :class="iconBgClass">
      <UIcon :name="icon" class="w-8 h-8 sm:w-10 sm:h-10" :class="iconColorClass" />
    </div>

    <!-- Title -->
    <h3 class="text-base sm:text-lg font-semibold mb-2">
      {{ title }}
    </h3>

    <!-- Description -->
    <p class="text-xs sm:text-sm text-muted-foreground max-w-md mx-auto mb-6">
      {{ description }}
    </p>

    <!-- Action Buttons -->
    <div v-if="$slots.actions" class="flex flex-col sm:flex-row gap-3 justify-center items-center">
      <slot name="actions" />
    </div>
  </div>
</template>

<script setup lang="ts">
interface Props {
  icon?: string
  title: string
  description: string
  variant?: 'default' | 'primary' | 'warning' | 'error'
}

const props = withDefaults(defineProps<Props>(), {
  icon: 'i-lucide-inbox',
  variant: 'default'
})

const iconBgClass = computed(() => {
  switch (props.variant) {
    case 'primary':
      return 'bg-primary/10'
    case 'warning':
      return 'bg-amber-500/10'
    case 'error':
      return 'bg-red-500/10'
    default:
      return 'bg-muted/50'
  }
})

const iconColorClass = computed(() => {
  switch (props.variant) {
    case 'primary':
      return 'text-primary'
    case 'warning':
      return 'text-amber-500'
    case 'error':
      return 'text-red-500'
    default:
      return 'text-muted-foreground'
  }
})
</script>
