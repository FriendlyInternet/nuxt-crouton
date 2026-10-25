/**
 * useUserMenuItems
 *
 * Shared composable that builds the user dropdown menu items.
 * Used by both CroutonUserPill and CroutonPagesNav (public nav)
 * so theme items, language switching, dark mode, and logout are always in sync.
 *
 * Reads theme items from the shared useState key populated by the
 * crouton-themes themeProvider.client plugin (empty when themes layer is inactive).
 */
import type { DropdownMenuItem } from '@nuxt/ui'

export interface UserMenuItemsOptions {
  /** When true, Account Settings opens a modal instead of navigating to /account */
  useModal?: boolean
}

export function useUserMenuItems(options?: UserMenuItemsOptions) {
  const { t } = useT()
  const { user, logout, loading } = useAuth()
  const { isAdmin } = useTeam()
  const router = useRouter()
  const notify = useNotify()
  const { locale, setLocale, locales } = useI18n()
  const colorMode = useColorMode()
  const accountModal = options?.useModal ? useAccountSettingsModal() : null

  const isDark = computed({
    get: () => colorMode.value === 'dark',
    set: (value: boolean) => {
      colorMode.preference = value ? 'dark' : 'light'
    }
  })

  const flags: Record<string, string> = {
    en: '🇬🇧',
    nl: '🇳🇱',
    fr: '🇫🇷'
  }

  // Theme items injected by crouton-themes plugin — [] when themes layer is not active
  const themePreferenceItems = useState<DropdownMenuItem[]>('crouton:themePreferenceItems', () => [])
  // Set by team-theme plugin (crouton-admin); defaults true when not present
  const allowUserThemes = useState<boolean>('crouton:allowUserThemes', () => true)
  const canSwitchTheme = computed(() => allowUserThemes.value || isAdmin.value)

  const userInitials = computed(() => {
    if (!user.value?.name) return '?'
    return user.value.name
      .split(' ')
      .map(n => n[0])
      .join('')
      .toUpperCase()
      .slice(0, 2)
  })

  const languageItems = computed<DropdownMenuItem[]>(() => {
    return (locales.value as Array<{ code: string, name?: string }>).map(loc => ({
      label: `${flags[loc.code] || '🌐'} ${loc.name || loc.code.toUpperCase()}`,
      onSelect: async (e: Event) => {
        e.preventDefault()
        await setLocale(loc.code as any)
      },
      active: locale.value === loc.code
    }))
  })

  async function handleLogout() {
    try {
      await logout()
      notify.success(t('auth.signedOut'), { description: t('auth.signedOutDescription') })
      await router.push('/auth/login')
    } catch (error: unknown) {
      notify.error(t('common.error'), { description: error instanceof Error ? error.message : t('auth.failedToSignOut') })
    }
  }

  // Language / dark mode / theme — shared with the signed-out pill menu
  const preferenceItems = computed<DropdownMenuItem[]>(() => [
    // Language submenu — only when the app has more than one locale
    ...(locales.value.length > 1
      ? [{
          label: t('forms.language'),
          icon: 'i-lucide-globe',
          children: languageItems.value
        }]
      : []),
    {
      label: t('account.darkMode'),
      icon: isDark.value ? 'i-lucide-moon' : 'i-lucide-sun',
      type: 'checkbox',
      checked: isDark.value,
      onUpdateChecked: (checked: boolean) => {
        isDark.value = checked
      },
      onSelect: (e: Event) => {
        e.preventDefault()
      }
    },
    // Theme switcher — only when themes layer is active and user is allowed
    ...(canSwitchTheme.value ? themePreferenceItems.value : [])
  ] as DropdownMenuItem[])

  const dropdownItems = computed<DropdownMenuItem[][]>(() => {
    return [
      [
        {
          label: user.value?.name || t('account.user'),
          avatar: {
            src: user.value?.image ?? undefined,
            alt: user.value?.name ?? t('account.user'),
            text: userInitials.value
          },
          type: 'label'
        }
      ],
      [
        {
          label: t('navigation.accountSettings'),
          icon: 'i-lucide-user',
          ...(accountModal
            ? {
                onSelect: () => accountModal.open('profile')
              }
            : {
                to: '/account'
              }
          )
        }
      ],
      preferenceItems.value,
      [
        {
          label: t('auth.signOut'),
          icon: 'i-lucide-log-out',
          color: 'error',
          onSelect: handleLogout
        }
      ]
    ]
  })

  return {
    user,
    loading,
    userInitials,
    dropdownItems,
    preferenceItems
  }
}