import { computed } from 'vue'
import { useToggle, useTimeoutFn } from '@vueuse/core'

export interface UseExpandableSlideoverOptions {
  defaultExpanded?: boolean
  maxWidth?: 'sm' | 'md' | 'lg' | 'xl' | '2xl' | '4xl' | '7xl' | 'full'
  closeOnExpand?: boolean
}

export function useExpandableSlideover(options: UseExpandableSlideoverOptions = {}) {
  const {
    defaultExpanded = false,
    maxWidth = 'xl',
    closeOnExpand = false
  } = options
  const { t } = useT()

  const [isOpen, toggleOpen] = useToggle(false)
  const [isExpanded, toggleExpanded] = useToggle(defaultExpanded)

  const { start: startCloseOnExpand } = useTimeoutFn(() => {
    isOpen.value = false
  }, 300, { immediate: false })

  const { start: startResetExpanded } = useTimeoutFn(() => {
    isExpanded.value = defaultExpanded
  }, 300, { immediate: false })

  // Toggle expand/collapse
  const toggleExpand = () => {
    toggleExpanded()

    // Optionally close on expand for immersive experience
    if (closeOnExpand && isExpanded.value) {
      startCloseOnExpand()
    }
  }

  // Expand to fullscreen
  const expand = () => {
    isExpanded.value = true
  }

  // Collapse to sidebar
  const collapse = () => {
    isExpanded.value = false
  }

  // Open slideover
  const open = (expanded = false) => {
    isOpen.value = true
    isExpanded.value = expanded
  }

  // Close slideover
  const close = () => {
    isOpen.value = false
    // Reset expanded state when closing
    startResetExpanded()
  }

  // Get content class for sidebar mode
  const getContentClass = () => {
    switch (maxWidth) {
      case 'sm': return 'right-0 inset-y-0 w-full max-w-sm'
      case 'md': return 'right-0 inset-y-0 w-full max-w-md'
      case 'lg': return 'right-0 inset-y-0 w-full max-w-lg'
      case 'xl': return 'right-0 inset-y-0 w-full max-w-xl'
      case '2xl': return 'right-0 inset-y-0 w-full max-w-2xl'
      case '4xl': return 'right-0 inset-y-0 w-full max-w-4xl'
      case '7xl': return 'right-0 inset-y-0 w-full max-w-7xl'
      case 'full': return 'right-0 inset-y-0 w-full'
      default: return 'right-0 inset-y-0 w-full max-w-xl'
    }
  }

  // Compute UI configuration based on expanded state
  const slideoverUi = computed(() => {
    // Base transition classes for smooth width animation
    const transitionClasses = 'transition-[max-width,width] duration-300 ease-in-out'
    const wrapperTransition = 'transition-all duration-300 ease-in-out'

    if (isExpanded.value) {
      // Fullscreen mode - override to full width with transitions
      return {
        overlay: 'fixed inset-0 bg-gray-900/80 backdrop-blur-sm transition-opacity duration-300',
        content: `right-0 inset-y-0 w-full max-w-none ${transitionClasses}`,
        wrapper: `w-full h-full ${wrapperTransition}`,
        body: `flex-1 overflow-y-auto p-6 ${wrapperTransition}`,
        header: 'flex items-center gap-1.5 p-4 sm:px-6 min-h-16 border-b border-gray-200 dark:border-gray-700'
      }
    }

    // Sidebar mode with configurable width and transitions
    return {
      overlay: 'transition-opacity duration-300',
      content: `${getContentClass()} ${transitionClasses}`,
      wrapper: wrapperTransition,
      body: wrapperTransition
    }
  })

  // Icon for expand/collapse button
  const expandIcon = computed(() =>
    isExpanded.value
      ? 'i-lucide-minimize-2'
      : 'i-lucide-maximize-2'
  )

  // Tooltip text for expand button
  const expandTooltip = computed(() =>
    isExpanded.value
      ? t('form.collapse')
      : t('form.expand')
  )

  return {
    isOpen,
    isExpanded,
    toggleExpand,
    expand,
    collapse,
    open,
    close,
    slideoverUi,
    expandIcon,
    expandTooltip
  }
}
