/**
 * Error Handling Utilities for @crouton/auth
 *
 * Provides standardized error codes, messages, and handling utilities.
 * Supports i18n through message keys.
 */

// ============================================================================
// Error Codes
// ============================================================================

export const AUTH_ERROR_CODES = {
  // Authentication errors
  AUTH_INVALID_CREDENTIALS: 'auth.invalid_credentials',
  AUTH_USER_NOT_FOUND: 'auth.user_not_found',
  AUTH_EMAIL_NOT_VERIFIED: 'auth.email_not_verified',
  AUTH_SESSION_EXPIRED: 'auth.session_expired',
  AUTH_UNAUTHORIZED: 'auth.unauthorized',
  AUTH_FORBIDDEN: 'auth.forbidden',
  AUTH_RATE_LIMITED: 'auth.rate_limited',

  // Registration errors
  REGISTER_EMAIL_EXISTS: 'auth.email_already_exists',
  REGISTER_INVALID_EMAIL: 'auth.invalid_email',
  REGISTER_WEAK_PASSWORD: 'auth.weak_password',
  REGISTER_PASSWORDS_MISMATCH: 'auth.passwords_mismatch',

  // Password errors
  PASSWORD_INCORRECT: 'auth.incorrect_password',
  PASSWORD_RESET_EXPIRED: 'auth.reset_token_expired',
  PASSWORD_RESET_INVALID: 'auth.reset_token_invalid',

  // 2FA errors
  TWO_FACTOR_INVALID_CODE: 'auth.invalid_2fa_code',
  TWO_FACTOR_ALREADY_ENABLED: 'auth.2fa_already_enabled',
  TWO_FACTOR_NOT_ENABLED: 'auth.2fa_not_enabled',
  TWO_FACTOR_BACKUP_CODE_USED: 'auth.backup_code_already_used',

  // Passkey errors
  PASSKEY_NOT_SUPPORTED: 'auth.passkey_not_supported',
  PASSKEY_REGISTRATION_FAILED: 'auth.passkey_registration_failed',
  PASSKEY_AUTHENTICATION_FAILED: 'auth.passkey_authentication_failed',

  // OAuth errors
  OAUTH_CANCELLED: 'auth.oauth_cancelled',
  OAUTH_FAILED: 'auth.oauth_failed',
  OAUTH_ACCOUNT_EXISTS: 'auth.oauth_account_exists',

  // Team errors
  TEAM_NOT_FOUND: 'team.not_found',
  TEAM_ACCESS_DENIED: 'team.access_denied',
  TEAM_LIMIT_REACHED: 'team.limit_reached',
  TEAM_MEMBER_LIMIT_REACHED: 'team.member_limit_reached',
  TEAM_ALREADY_MEMBER: 'team.already_member',
  TEAM_NOT_MEMBER: 'team.not_member',
  TEAM_OWNER_REQUIRED: 'team.owner_required',
  TEAM_ADMIN_REQUIRED: 'team.admin_required',
  TEAM_CANNOT_REMOVE_OWNER: 'team.cannot_remove_owner',
  TEAM_CANNOT_LEAVE_AS_OWNER: 'team.cannot_leave_as_owner',
  TEAM_SLUG_EXISTS: 'team.slug_already_exists',

  // Invitation errors
  INVITATION_NOT_FOUND: 'team.invitation_not_found',
  INVITATION_EXPIRED: 'team.invitation_expired',
  INVITATION_ALREADY_ACCEPTED: 'team.invitation_already_accepted',

  // Billing errors
  BILLING_NOT_ENABLED: 'billing.not_enabled',
  BILLING_SUBSCRIPTION_NOT_FOUND: 'billing.subscription_not_found',
  BILLING_PAYMENT_FAILED: 'billing.payment_failed',
  BILLING_PLAN_NOT_FOUND: 'billing.plan_not_found',

  // Network errors
  NETWORK_ERROR: 'error.network',
  NETWORK_TIMEOUT: 'error.timeout',
  SERVER_ERROR: 'error.server',
  UNKNOWN_ERROR: 'error.unknown'
} as const

export type AuthErrorCode = (typeof AUTH_ERROR_CODES)[keyof typeof AUTH_ERROR_CODES]

// ============================================================================
// Default Error Messages (English)
// ============================================================================

export const DEFAULT_ERROR_MESSAGES: Record<AuthErrorCode, string> = {
  // Authentication
  [AUTH_ERROR_CODES.AUTH_INVALID_CREDENTIALS]: 'Invalid email or password',
  [AUTH_ERROR_CODES.AUTH_USER_NOT_FOUND]: 'User not found',
  [AUTH_ERROR_CODES.AUTH_EMAIL_NOT_VERIFIED]: 'Please verify your email address',
  [AUTH_ERROR_CODES.AUTH_SESSION_EXPIRED]: 'Your session has expired. Please sign in again.',
  [AUTH_ERROR_CODES.AUTH_UNAUTHORIZED]: 'You must be signed in to access this resource',
  [AUTH_ERROR_CODES.AUTH_FORBIDDEN]: 'You do not have permission to access this resource',
  [AUTH_ERROR_CODES.AUTH_RATE_LIMITED]: 'Too many attempts. Please try again later.',

  // Registration
  [AUTH_ERROR_CODES.REGISTER_EMAIL_EXISTS]: 'An account with this email already exists',
  [AUTH_ERROR_CODES.REGISTER_INVALID_EMAIL]: 'Please enter a valid email address',
  [AUTH_ERROR_CODES.REGISTER_WEAK_PASSWORD]: 'Password must be at least 8 characters',
  [AUTH_ERROR_CODES.REGISTER_PASSWORDS_MISMATCH]: 'Passwords do not match',

  // Password
  [AUTH_ERROR_CODES.PASSWORD_INCORRECT]: 'Current password is incorrect',
  [AUTH_ERROR_CODES.PASSWORD_RESET_EXPIRED]: 'Password reset link has expired',
  [AUTH_ERROR_CODES.PASSWORD_RESET_INVALID]: 'Invalid password reset link',

  // 2FA
  [AUTH_ERROR_CODES.TWO_FACTOR_INVALID_CODE]: 'Invalid verification code',
  [AUTH_ERROR_CODES.TWO_FACTOR_ALREADY_ENABLED]: 'Two-factor authentication is already enabled',
  [AUTH_ERROR_CODES.TWO_FACTOR_NOT_ENABLED]: 'Two-factor authentication is not enabled',
  [AUTH_ERROR_CODES.TWO_FACTOR_BACKUP_CODE_USED]: 'This backup code has already been used',

  // Passkey
  [AUTH_ERROR_CODES.PASSKEY_NOT_SUPPORTED]: 'Passkeys are not supported on this device',
  [AUTH_ERROR_CODES.PASSKEY_REGISTRATION_FAILED]: 'Failed to register passkey. Please try again.',
  [AUTH_ERROR_CODES.PASSKEY_AUTHENTICATION_FAILED]: 'Failed to authenticate with passkey',

  // OAuth
  [AUTH_ERROR_CODES.OAUTH_CANCELLED]: 'Sign in was cancelled',
  [AUTH_ERROR_CODES.OAUTH_FAILED]: 'Sign in with provider failed. Please try again.',
  [AUTH_ERROR_CODES.OAUTH_ACCOUNT_EXISTS]: 'An account with this email already exists. Try signing in with a different method.',

  // Team
  [AUTH_ERROR_CODES.TEAM_NOT_FOUND]: 'Team not found',
  [AUTH_ERROR_CODES.TEAM_ACCESS_DENIED]: 'You do not have access to this team',
  [AUTH_ERROR_CODES.TEAM_LIMIT_REACHED]: 'You have reached the maximum number of teams',
  [AUTH_ERROR_CODES.TEAM_MEMBER_LIMIT_REACHED]: 'This team has reached its member limit',
  [AUTH_ERROR_CODES.TEAM_ALREADY_MEMBER]: 'User is already a member of this team',
  [AUTH_ERROR_CODES.TEAM_NOT_MEMBER]: 'You are not a member of this team',
  [AUTH_ERROR_CODES.TEAM_OWNER_REQUIRED]: 'Only the team owner can perform this action',
  [AUTH_ERROR_CODES.TEAM_ADMIN_REQUIRED]: 'You need admin privileges to perform this action',
  [AUTH_ERROR_CODES.TEAM_CANNOT_REMOVE_OWNER]: 'The team owner cannot be removed',
  [AUTH_ERROR_CODES.TEAM_CANNOT_LEAVE_AS_OWNER]: 'As the owner, you must transfer ownership before leaving',
  [AUTH_ERROR_CODES.TEAM_SLUG_EXISTS]: 'A team with this URL already exists',

  // Invitation
  [AUTH_ERROR_CODES.INVITATION_NOT_FOUND]: 'Invitation not found',
  [AUTH_ERROR_CODES.INVITATION_EXPIRED]: 'This invitation has expired',
  [AUTH_ERROR_CODES.INVITATION_ALREADY_ACCEPTED]: 'This invitation has already been accepted',

  // Billing
  [AUTH_ERROR_CODES.BILLING_NOT_ENABLED]: 'Billing is not enabled',
  [AUTH_ERROR_CODES.BILLING_SUBSCRIPTION_NOT_FOUND]: 'No active subscription found',
  [AUTH_ERROR_CODES.BILLING_PAYMENT_FAILED]: 'Payment failed. Please update your payment method.',
  [AUTH_ERROR_CODES.BILLING_PLAN_NOT_FOUND]: 'Plan not found',

  // Network
  [AUTH_ERROR_CODES.NETWORK_ERROR]: 'Network error. Please check your connection.',
  [AUTH_ERROR_CODES.NETWORK_TIMEOUT]: 'Request timed out. Please try again.',
  [AUTH_ERROR_CODES.SERVER_ERROR]: 'Server error. Please try again later.',
  [AUTH_ERROR_CODES.UNKNOWN_ERROR]: 'An unexpected error occurred'
}

// ============================================================================
// i18n mapping (code -> locale key)
// ============================================================================

/**
 * Locale key for an error code. Codes are already dotted (`auth.invalid_credentials`),
 * so the key is simply `errors.<code>`. Pure — callers (which may run outside a
 * component) pass their own `t`, we never call `useT()` at module level.
 */
export function errorMessageKey(code: AuthErrorCode): string {
  return `errors.${code}`
}

/**
 * Translate an error code, falling back to the English default when the
 * locale has no entry (`t` returns the key unchanged for a missing key).
 */
export function translateErrorCode(code: AuthErrorCode, t: (key: string) => string): string {
  const key = errorMessageKey(code)
  const msg = t(key)
  return msg && msg !== key ? msg : DEFAULT_ERROR_MESSAGES[code]
}

/**
 * User-facing text for an error: translated when the message is just the
 * default for its code, untouched when it carries custom/server text.
 */
export function localizeError(error: unknown, t: (key: string) => string): string {
  const code = getErrorCode(error)
  const message = isAuthError(error) ? error.message : getErrorMessage(error)
  return message === DEFAULT_ERROR_MESSAGES[code] ? translateErrorCode(code, t) : message
}

// ============================================================================
// Auth Error Class
// ============================================================================

export class AuthError extends Error {
  code: AuthErrorCode
  statusCode?: number
  details?: Record<string, unknown>

  constructor(
    code: AuthErrorCode,
    message?: string,
    options?: {
      statusCode?: number
      details?: Record<string, unknown>
      cause?: Error
    }
  ) {
    super(message ?? DEFAULT_ERROR_MESSAGES[code] ?? code)
    this.name = 'AuthError'
    this.code = code
    this.statusCode = options?.statusCode
    this.details = options?.details
    this.cause = options?.cause
  }

  /**
   * Create a user-friendly error message
   */
  toUserMessage(): string {
    return DEFAULT_ERROR_MESSAGES[this.code] ?? this.message
  }

  /**
   * Convert to plain object for logging/serialization
   */
  toJSON() {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      statusCode: this.statusCode,
      details: this.details
    }
  }
}

// ============================================================================
// Error Helpers
// ============================================================================

/**
 * Check if an error is an AuthError
 */
export function isAuthError(error: unknown): error is AuthError {
  return error instanceof AuthError
}

/**
 * Get user-friendly error message from any error
 */
export function getErrorMessage(error: unknown): string {
  if (isAuthError(error)) {
    return error.toUserMessage()
  }

  if (error instanceof Error) {
    // Check for common error patterns
    const message = error.message.toLowerCase()

    if (message.includes('network') || message.includes('fetch')) {
      return DEFAULT_ERROR_MESSAGES[AUTH_ERROR_CODES.NETWORK_ERROR]
    }

    if (message.includes('timeout')) {
      return DEFAULT_ERROR_MESSAGES[AUTH_ERROR_CODES.NETWORK_TIMEOUT]
    }

    if (message.includes('unauthorized') || message.includes('401')) {
      return DEFAULT_ERROR_MESSAGES[AUTH_ERROR_CODES.AUTH_UNAUTHORIZED]
    }

    if (message.includes('forbidden') || message.includes('403')) {
      return DEFAULT_ERROR_MESSAGES[AUTH_ERROR_CODES.AUTH_FORBIDDEN]
    }

    return error.message
  }

  if (typeof error === 'string') {
    return error
  }

  return DEFAULT_ERROR_MESSAGES[AUTH_ERROR_CODES.UNKNOWN_ERROR]
}

/**
 * Get error code from error
 */
export function getErrorCode(error: unknown): AuthErrorCode {
  if (isAuthError(error)) {
    return error.code
  }

  if (error instanceof Error) {
    const message = error.message.toLowerCase()

    if (message.includes('network') || message.includes('fetch')) {
      return AUTH_ERROR_CODES.NETWORK_ERROR
    }

    if (message.includes('timeout')) {
      return AUTH_ERROR_CODES.NETWORK_TIMEOUT
    }
  }

  return AUTH_ERROR_CODES.UNKNOWN_ERROR
}

/**
 * Create an AuthError from a fetch response
 */
export async function authErrorFromResponse(response: Response): Promise<AuthError> {
  let code: AuthErrorCode = AUTH_ERROR_CODES.UNKNOWN_ERROR
  let message: string | undefined
  let details: Record<string, unknown> | undefined

  // Try to parse error body
  try {
    const body = await response.json()
    if (body.code && Object.values(AUTH_ERROR_CODES).includes(body.code)) {
      code = body.code
    }
    message = body.message
    details = body.details
  } catch {
    // Ignore parse errors
  }

  // Map HTTP status codes to error codes
  if (code === AUTH_ERROR_CODES.UNKNOWN_ERROR) {
    switch (response.status) {
      case 401:
        code = AUTH_ERROR_CODES.AUTH_UNAUTHORIZED
        break
      case 403:
        code = AUTH_ERROR_CODES.AUTH_FORBIDDEN
        break
      case 404:
        code = AUTH_ERROR_CODES.AUTH_USER_NOT_FOUND
        break
      case 429:
        code = AUTH_ERROR_CODES.AUTH_RATE_LIMITED
        break
      case 500:
        code = AUTH_ERROR_CODES.SERVER_ERROR
        break
    }
  }

  return new AuthError(code, message, {
    statusCode: response.status,
    details
  })
}

/**
 * Wrap an async function with standardized error handling
 */
export function withErrorHandling<T extends (...args: any[]) => Promise<any>>(
  fn: T,
  options?: {
    onError?: (error: AuthError) => void
    rethrow?: boolean
  }
): T {
  return (async (...args: Parameters<T>) => {
    try {
      return await fn(...args)
    } catch (error) {
      const authError = isAuthError(error)
        ? error
        : new AuthError(
            getErrorCode(error),
            getErrorMessage(error),
            { cause: error instanceof Error ? error : undefined }
          )

      options?.onError?.(authError)

      if (options?.rethrow !== false) {
        throw authError
      }

      return undefined
    }
  }) as T
}
