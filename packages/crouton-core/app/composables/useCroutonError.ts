// v1.0.2 - Removed debug console.log statements for production
import { promiseTimeout } from '@vueuse/core'

export default function () {
  // Global i18n instance, not useT()/useI18n(): this composable is created from
  // plugins (crouton-collab's form presence) and used from click handlers,
  // where useI18n() has no component instance and logs a fallback warning.
  const nuxtApp = useNuxtApp()
  const t = (key: string): string => (nuxtApp.$i18n as { t?: (k: string) => string } | undefined)?.t?.(key) ?? key
  const activeToast = useState('activeToasts', () => false)
  const toastVibration = useState('toastVibration', () => false)

  const vibrateToast = async () => {
    if (activeToast.value) toastVibration.value = true
    await promiseTimeout(500)
    toastVibration.value = false
  }

  const triggerErrorMessage = (type: string, message: string, description: string | null, _multiple: boolean) => {
    if (activeToast.value) return vibrateToast()
    activeToast.value = true
    if (type === 'error') {
      const notify = useNotify()
      notify.error(message, { description: description || undefined })
    }
    toastVibration.value = false
  }

  const foundErrors = () => {
    const isOnline = useNetwork().isOnline.value

    if (!isOnline) {
      triggerErrorMessage('error', t('errors.checkConnection'), null, false)
      return true
    }

    const userSession = useSession()
    const loggedIn = !!userSession.user?.value

    if (!loggedIn) {
      triggerErrorMessage('error', t('errors.notLoggedIn'), null, false)
      return true
    }

    return false
  }

  return {
    foundErrors,
    activeToast,
    toastVibration
  }
}
