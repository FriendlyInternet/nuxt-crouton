/**
 * useAuthError Composable
 *
 * Provides standardized error handling for auth-related operations.
 * Integrates with toast notifications and error state management.
 *
 * @example
 * ```typescript
 * const { error, clearError, handleError, withError } = useAuthError()
 *
 * // Manual error handling
 * try {
 *   await login(credentials)
 * } catch (e) {
 *   handleError(e)
 * }
 *
 * // Automatic error handling wrapper
 * const login = withError(async () => {
 *   await authClient.signIn.email(credentials)
 * })
 * ```
 */
import {
  AuthError,
  getErrorMessage,
  getErrorCode,
  localizeError,
  isAuthError,
  AUTH_ERROR_CODES,
  type AuthErrorCode
} from '../utils/errors'

export interface UseAuthErrorOptions {
  /** Show toast notification on error */
  showToast?: boolean
  /** Toast duration in milliseconds */
  toastDuration?: number
  /** Custom error handler */
  onError?: (error: AuthError) => void
}

export function useAuthError(options: UseAuthErrorOptions = {}) {
  const { showToast = true, toastDuration = 5000 } = options

  const error = ref<AuthError | null>(null)
  const notify = useNotify()
  const { t } = useT()

  const errorMessage = computed(() => error.value ? localizeError(error.value, t) : null)
  const errorCode = computed(() => error.value?.code ?? null)

  /**
   * Clear the current error
   */
  function clearError() {
    error.value = null
  }

  /**
   * Handle an error - sets error state and optionally shows toast
   */
  function handleError(e: unknown, toastOptions?: { show?: boolean, duration?: number }) {
    const authError = isAuthError(e)
      ? e
      : new AuthError(
          getErrorCode(e),
          getErrorMessage(e),
          { cause: e instanceof Error ? e : undefined }
        )

    error.value = authError

    // Show toast notification
    if (toastOptions?.show ?? showToast) {
      notify.error(t('common.error'), {
        description: localizeError(authError, t),
        icon: 'i-lucide-circle-alert',
      } as any)
    }

    // Call custom error handler
    options.onError?.(authError)

    return authError
  }

  /**
   * Wrap an async function with error handling
   */
  function withError<T extends (...args: any[]) => Promise<any>>(
    fn: T,
    errorOptions?: { showToast?: boolean, clearOnStart?: boolean }
  ): (...args: Parameters<T>) => Promise<Awaited<ReturnType<T>> | undefined> {
    return async (...args: Parameters<T>) => {
      if (errorOptions?.clearOnStart !== false) {
        clearError()
      }

      try {
        return await fn(...args)
      } catch (e) {
        handleError(e, { show: errorOptions?.showToast })
        return undefined
      }
    }
  }

  /**
   * Check if the current error matches a specific code
   */
  function isError(code: AuthErrorCode): boolean {
    return errorCode.value === code
  }

  /**
   * Check if there's an active error
   */
  const hasError = computed(() => error.value !== null)

  /**
   * Check if the error is a network-related error
   */
  const isNetworkError = computed(() => {
    const code = errorCode.value
    return (
      code === AUTH_ERROR_CODES.NETWORK_ERROR
      || code === AUTH_ERROR_CODES.NETWORK_TIMEOUT
      || code === AUTH_ERROR_CODES.SERVER_ERROR
    )
  })

  /**
   * Check if the error is an auth-related error (user should re-authenticate)
   */
  const isAuthenticationError = computed(() => {
    const code = errorCode.value
    return (
      code === AUTH_ERROR_CODES.AUTH_UNAUTHORIZED
      || code === AUTH_ERROR_CODES.AUTH_SESSION_EXPIRED
      || code === AUTH_ERROR_CODES.AUTH_FORBIDDEN
    )
  })

  return {
    // State
    error,
    errorMessage,
    errorCode,
    hasError,
    isNetworkError,
    isAuthenticationError,

    // Actions
    clearError,
    handleError,
    withError,
    isError,

    // Re-export for convenience
    AUTH_ERROR_CODES
  }
}

/**
 * Create an error handler that logs errors
 */
export function createErrorLogger(prefix: string = '[@crouton/auth]') {
  return (error: AuthError) => {
    console.error(`${prefix} Error:`, {
      code: error.code,
      message: error.message,
      statusCode: error.statusCode,
      details: error.details
    })
  }
}
