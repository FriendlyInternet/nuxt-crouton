/**
 * Security Utilities for @crouton/auth
 *
 * Input validation and security helpers for client-side code.
 * Server-side validation is handled by Better Auth and Zod schemas.
 */

// ============================================================================
// Email Validation
// ============================================================================

/**
 * Validate email format
 */
export function isValidEmail(email: string): boolean {
  const emailRegex = /^[^\s@]+@[^\s@][^\s.@]*\.[^\s@]+$/
  return emailRegex.test(email)
}

/**
 * Sanitize email (lowercase, trim)
 * @public Available for consumer apps to use directly.
 */
export function sanitizeEmail(email: string): string {
  return email.toLowerCase().trim()
}

// ============================================================================
// Password Validation
// ============================================================================

export interface PasswordValidationResult {
  valid: boolean
  errors: string[]
  strength: 'weak' | 'fair' | 'good' | 'strong'
}

export interface PasswordRequirements {
  minLength?: number
  maxLength?: number
  requireUppercase?: boolean
  requireLowercase?: boolean
  requireNumbers?: boolean
  requireSpecial?: boolean
}

const DEFAULT_PASSWORD_REQUIREMENTS: PasswordRequirements = {
  minLength: 8,
  maxLength: 128,
  requireUppercase: false,
  requireLowercase: false,
  requireNumbers: false,
  requireSpecial: false
}

/**
 * Validate password against requirements
 */
export function validatePassword(
  password: string,
  requirements: PasswordRequirements = {}
): PasswordValidationResult {
  const reqs = { ...DEFAULT_PASSWORD_REQUIREMENTS, ...requirements }
  const errors: string[] = []

  if (password.length < reqs.minLength!) {
    errors.push(`Password must be at least ${reqs.minLength} characters`)
  }

  if (password.length > reqs.maxLength!) {
    errors.push(`Password must be at most ${reqs.maxLength} characters`)
  }

  if (reqs.requireUppercase && !/[A-Z]/.test(password)) {
    errors.push('Password must contain at least one uppercase letter')
  }

  if (reqs.requireLowercase && !/[a-z]/.test(password)) {
    errors.push('Password must contain at least one lowercase letter')
  }

  if (reqs.requireNumbers && !/\d/.test(password)) {
    errors.push('Password must contain at least one number')
  }

  if (reqs.requireSpecial && !/[!@#$%^&*(),.?":{}|<>]/.test(password)) {
    errors.push('Password must contain at least one special character')
  }

  // Calculate strength
  let strengthScore = 0
  if (password.length >= 8) strengthScore++
  if (password.length >= 12) strengthScore++
  if (/[A-Z]/.test(password)) strengthScore++
  if (/[a-z]/.test(password)) strengthScore++
  if (/\d/.test(password)) strengthScore++
  if (/[!@#$%^&*(),.?":{}|<>]/.test(password)) strengthScore++

  let strength: 'weak' | 'fair' | 'good' | 'strong' = 'weak'
  if (strengthScore >= 5) strength = 'strong'
  else if (strengthScore >= 4) strength = 'good'
  else if (strengthScore >= 3) strength = 'fair'

  return {
    valid: errors.length === 0,
    errors,
    strength
  }
}

/**
 * Check if passwords match
 */
export function passwordsMatch(password: string, confirmPassword: string): boolean {
  return password === confirmPassword
}

// ============================================================================
// Team/Slug Validation
// ============================================================================

/**
 * Validate team slug format
 * - 3-50 characters
 * - Lowercase letters, numbers, hyphens
 * - Must start and end with letter or number
 * @public Available for consumer apps to use directly.
 */
export function isValidSlug(slug: string): boolean {
  const slugRegex = /^[a-z0-9][a-z0-9-]{1,48}[a-z0-9]$/
  return slugRegex.test(slug)
}

/**
 * Generate a valid slug from text
 * @public Available for consumer apps to use directly.
 */
export function generateSlug(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '') // Remove special chars
    .replace(/[\s_]+/g, '-') // Replace spaces/underscores with hyphens
    .replace(/-+/g, '-') // Remove consecutive hyphens
    .replace(/^-|-$/g, '') // Remove leading/trailing hyphens
    .slice(0, 50) // Limit length
}

/**
 * Validate team name
 * @public Available for consumer apps to use directly.
 */
export function isValidTeamName(name: string): boolean {
  return name.length >= 2 && name.length <= 100
}

// ============================================================================
// Input Sanitization
// ============================================================================

/**
 * Sanitize user input (removes potential XSS)
 */
export function sanitizeInput(input: string): string {
  return input
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;')
}

/**
 * Sanitize URL (ensure it's safe to redirect to)
 * @public Available for consumer apps to use directly.
 */
export function sanitizeRedirectUrl(url: string): string {
  // Tab/newline are stripped by browsers inside URLs ("/\t/evil" → "//evil"),
  // and a backslash is treated as "/" — reject all of them outright.
  // eslint-disable-next-line no-control-regex
  if (typeof url !== 'string' || /[\u0000-\u001f\u007f\\]/.test(url)) return '/'
  // Resolve against the app's own origin (a fixed dummy one during SSR) and
  // keep the result only if it stays on that origin.
  const origin = typeof window !== 'undefined' ? window.location.origin : 'http://app.invalid'
  try {
    const parsed = new URL(url, origin)
    if (parsed.origin !== origin) return '/'
    return parsed.pathname + parsed.search + parsed.hash
  } catch {
    return '/'
  }
}

// ============================================================================
// Security Headers Check
// ============================================================================

/**
 * Check if the app is running over HTTPS
 * @public Available for consumer apps to use directly.
 */
export function isSecureContext(): boolean {
  if (typeof window === 'undefined') return true // SSR
  return window.isSecureContext
}

/**
 * Check if cookies are enabled
 */
export function areCookiesEnabled(): boolean {
  if (typeof document === 'undefined') return true // SSR
  try {
    document.cookie = 'crouton_cookie_test=1'
    const enabled = document.cookie.includes('crouton_cookie_test')
    document.cookie = 'crouton_cookie_test=; expires=Thu, 01 Jan 1970 00:00:00 GMT'
    return enabled
  } catch {
    return false
  }
}

// ============================================================================
// Timing-Safe Comparison
// ============================================================================

/**
 * Timing-safe string comparison (for tokens)
 * Note: Server-side validation should use crypto.timingSafeEqual
 */
export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false

  let result = 0
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i)
  }

  return result === 0
}
