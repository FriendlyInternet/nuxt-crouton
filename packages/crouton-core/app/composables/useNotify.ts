type NotifyLevel = 'success' | 'info' | 'warning' | 'error'

interface NotifyOptions {
  target?: 'auto' | 'toast' | 'statusbar'
  description?: string
  icon?: string
  collection?: string
  operation?: string
  retry?: () => void
}

const LEVEL_DEFAULTS: Record<NotifyLevel, { icon: string; color: string }> = {
  success: { icon: 'i-lucide-check', color: 'success' },
  info: { icon: 'i-lucide-info', color: 'primary' },
  warning: { icon: 'i-lucide-alert-triangle', color: 'warning' },
  error: { icon: 'i-lucide-octagon-alert', color: 'error' },
}

/**
 * The app "has the pill" when crouton-auth (which ships CroutonUserPill) is a layer
 * (`appConfig.crouton.status = 'pill'`). Decided from config, never from what is mounted.
 */
export function hasStatusPill(appConfig: { crouton?: { status?: string } }): boolean {
  return appConfig.crouton?.status === 'pill'
}

/** Pure routing rule: status feed unless the app has no pill or the caller opted out. */
export function routeNotification(target: NotifyOptions['target'], pill: boolean): 'toast' | 'statusbar' {
  if (target === 'toast') return 'toast'
  if (target === 'statusbar') return 'statusbar'
  return pill ? 'statusbar' : 'toast'
}

const TOAST_COLOR_LEVEL: Record<string, NotifyLevel> = {
  success: 'success',
  info: 'info',
  primary: 'info',
  warning: 'warning',
  error: 'error',
}

export function useNotify() {
  const toast = useToast()
  const pill = hasStatusPill(useAppConfig() as any)

  function notify(level: NotifyLevel, title: string, options: NotifyOptions = {}) {
    const { description, icon, collection, operation, retry } = options
    const defaults = LEVEL_DEFAULTS[level]

    if (routeNotification(options.target, pill) === 'statusbar') {
      const { push } = useCroutonStatus()
      push({
        text: title,
        description,
        icon: icon || defaults.icon,
        type: level,
        collection,
        operation,
        retry,
      })
      return
    }

    toast.add({
      title,
      description,
      icon: icon || defaults.icon,
      color: defaults.color as any,
    })
  }

  /**
   * Drop-in for `useToast().add()`: status-like toasts (success/info/warning/error colour,
   * no action buttons) go through the feed; anything else passes through as a real toast.
   */
  function add(input: { title?: string, description?: string, icon?: string, color?: string, actions?: unknown[], [key: string]: any }) {
    const level = input.color ? TOAST_COLOR_LEVEL[input.color] : undefined
    if (!level || !input.title || input.actions?.length) {
      return toast.add(input as any)
    }
    notify(level, input.title, { description: input.description, icon: input.icon })
  }

  return {
    success: (title: string, options?: NotifyOptions) => notify('success', title, options),
    info: (title: string, options?: NotifyOptions) => notify('info', title, options),
    warning: (title: string, options?: NotifyOptions) => notify('warning', title, options),
    error: (title: string, options?: NotifyOptions) => notify('error', title, options),
    add,
  }
}
