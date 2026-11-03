// useThemeMenuItems
// Returns DropdownMenuItem[] compatible with UDropdownMenu
// Designed for injecting theme selection into any user menu
//
// Usage in CroutonUserPill:
//   const { themeMenuItem } = useThemeMenuItems()
//   // Add themeMenuItem to your preferenceItems prop

import type { DropdownMenuItem } from '@nuxt/ui'
import { useThemeSwitcher } from './useThemeSwitcher'

export function useThemeMenuItems() {
  const { currentTheme, themes, setTheme } = useThemeSwitcher()

  // A submenu item: "Theme >" that expands to all theme options
  // Each option shows the theme's primary color as a small avatar circle
  const themeMenuItem = computed<DropdownMenuItem>(() => ({
    label: 'Theme',
    icon: 'i-lucide-palette',
    children: themes.map(theme => ({
      label: theme.label,
      active: currentTheme.value === theme.name,
      // Use avatar with inline style to show a color circle per theme
      avatar: {
        style: { backgroundColor: theme.colors[0] },
        class: 'rounded-full',
        alt: theme.label
      },
      onSelect: (e: Event) => {
        // Prevent dropdown from closing so user can see active state change
        e.preventDefault()
        setTheme(theme.name)
      }
    }))
  }))

  return {
    themeMenuItem
  }
}
