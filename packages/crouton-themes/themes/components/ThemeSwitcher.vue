<script setup lang="ts">
import { useThemeSwitcher, type ThemeName } from '../composables/useThemeSwitcher'

interface Props {
  /** Show as dropdown menu (default) or inline buttons */
  mode?: 'dropdown' | 'inline' | 'cycle'
  /** Size of the switcher */
  size?: 'xs' | 'sm' | 'md' | 'lg'
  /** Show dark mode toggle button */
  showColorMode?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  mode: 'dropdown',
  size: 'sm',
  showColorMode: false
})

const { currentTheme, currentThemeConfig, themes, setTheme, cycleTheme } = useThemeSwitcher()
const colorMode = useColorMode()

const toggleColorMode = () => {
  colorMode.preference = colorMode.value === 'dark' ? 'light' : 'dark'
}

// Dropdown menu items with custom slot for color swatches.
// Slot names are prefixed: a bare theme name would collide with Vue's
// reserved slots — the 'default' theme literally became `#default` and
// silently REPLACED the dropdown's trigger slot with a static item row
// (the chip stuck on "Default" forever).
const menuItems = computed(() =>
  themes.map(theme => ({
    label: theme.label,
    slot: `theme-${theme.name}`,
    onSelect: () => setTheme(theme.name),
    active: currentTheme.value === theme.name
  }))
)
</script>

<template>
  <div class="flex items-center gap-1">
    <!-- Dropdown Mode -->
    <UDropdownMenu
      v-if="mode === 'dropdown'"
      :items="menuItems"
    >
      <UButton
        color="neutral"
        variant="ghost"
        :size="size"
        trailing-icon="i-lucide-chevron-down"
      >
        <!-- Color swatches for current theme -->
        <span class="flex items-center gap-1.5">
          <span class="flex -space-x-0.5">
            <span
              v-for="(color, i) in currentThemeConfig?.colors"
              :key="i"
              class="size-3 rounded-full ring-1 ring-white dark:ring-gray-800"
              :style="{ backgroundColor: color }"
            />
          </span>
          {{ currentThemeConfig?.label }}
        </span>
      </UButton>

      <!-- Custom slots for each theme item (prefixed — see menuItems) -->
      <template v-for="theme in themes" :key="theme.name" #[`theme-${theme.name}`]>
        <span class="flex items-center gap-2 w-full">
          <span class="flex -space-x-0.5">
            <span
              v-for="(color, i) in theme.colors"
              :key="i"
              class="size-3 rounded-full ring-1 ring-white dark:ring-gray-800"
              :style="{ backgroundColor: color }"
            />
          </span>
          <span>{{ theme.label }}</span>
        </span>
      </template>
    </UDropdownMenu>

    <!-- Cycle Mode - Single button that cycles through themes -->
    <UButton
      v-else-if="mode === 'cycle'"
      color="neutral"
      variant="ghost"
      :size="size"
      @click="cycleTheme"
    >
      <span class="flex items-center gap-1.5">
        <span class="flex -space-x-0.5">
          <span
            v-for="(color, i) in currentThemeConfig?.colors"
            :key="i"
            class="size-3 rounded-full ring-1 ring-white dark:ring-gray-800"
            :style="{ backgroundColor: color }"
          />
        </span>
        {{ currentThemeConfig?.label }}
      </span>
    </UButton>

    <!-- Inline Mode - Button group -->
    <UFieldGroup v-else :size="size">
      <UButton
        v-for="theme in themes"
        :key="theme.name"
        :color="currentTheme === theme.name ? 'primary' : 'neutral'"
        :variant="currentTheme === theme.name ? 'solid' : 'ghost'"
        @click="setTheme(theme.name)"
      >
        <span class="flex items-center gap-1.5">
          <span class="flex -space-x-0.5">
            <span
              v-for="(color, i) in theme.colors"
              :key="i"
              class="size-2.5 rounded-full ring-1 ring-white dark:ring-gray-800"
              :style="{ backgroundColor: color }"
            />
          </span>
          {{ theme.label }}
        </span>
      </UButton>
    </UFieldGroup>

    <!-- Dark mode toggle -->
    <UButton
      v-if="showColorMode"
      color="neutral"
      variant="ghost"
      :size="size"
      :icon="colorMode.value === 'dark' ? 'i-lucide-sun' : 'i-lucide-moon'"
      @click="toggleColorMode"
    />
  </div>
</template>
