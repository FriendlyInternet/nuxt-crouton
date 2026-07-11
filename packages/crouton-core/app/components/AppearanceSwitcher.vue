<script setup lang="ts">
import type { Component } from 'vue'

interface Props {
  mode?: 'dropdown' | 'inline' | 'cycle'
  size?: 'xs' | 'sm' | 'md' | 'lg'
  showDarkMode?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  mode: 'dropdown',
  size: 'sm',
  showDarkMode: true
})

// Runtime detection of themes package
// Uses shallowRef for component refs (performance)
const hasThemeSwitcher = ref(false)
const ThemeSwitcherComponent = shallowRef<Component | null>(null)

onMounted(() => {
  // Try to detect if themes package is installed
  try {
    // Check if useThemeSwitcher composable exists and works
    // @ts-ignore - composable only exists when the crouton-themes layer is extended
    const themeSwitcher = useThemeSwitcher?.()
    if (themeSwitcher?.currentTheme) {
      // Themes package is installed, resolve the component
      const resolved = resolveComponent('ThemeSwitcher')
      if (typeof resolved !== 'string') {
        ThemeSwitcherComponent.value = resolved
        hasThemeSwitcher.value = true
      }
    }
  } catch {
    // Themes package not installed - that's fine, just show dark mode toggle
  }
})
</script>

<template>
  <div class="flex items-center gap-1">
    <!-- Theme switcher (only if nuxt-crouton-themes is installed) -->
    <component
      :is="ThemeSwitcherComponent"
      v-if="hasThemeSwitcher"
      :mode="props.mode"
      :size="props.size"
    />
    <!-- Dark mode toggle (always available) -->
    <CroutonDarkModeSwitcher v-if="showDarkMode" :size="size" />
  </div>
</template>
