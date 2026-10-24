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

export function useNotify() {
  const toast = useToast()
  const statusBarActive = useState<boolean>('crouton-status-bar-active', () => false)

  function notify(level: NotifyLevel, title: string, options: NotifyOptions = {}) {
    const { target = 'auto', description, icon, collection, operation, retry } = options
    const defaults = LEVEL_DEFAULTS[level]

    const useStatusBar = target === 'statusbar'
      || (target === 'auto' && (level === 'success' || level === 'info' || level === 'warning') && statusBarActive.value)

    if (useStatusBar) {
      const { push } = useCroutonStatus()
      push({
        text: title,
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

  return {
    success: (title: string, options?: NotifyOptions) => notify('success', title, options),
    info: (title: string, options?: NotifyOptions) => notify('info', title, options),
    warning: (title: string, options?: NotifyOptions) => notify('warning', title, options),
    error: (title: string, options?: NotifyOptions) => notify('error', title, options),
  }
}
