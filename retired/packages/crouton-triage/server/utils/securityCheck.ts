/**
 * Security Check Utilities
 *
 * Provides:
 * - Environment variable validation
 * - Security configuration checks
 * - Secret detection helpers
 *
 * Run these checks on application startup to ensure proper security configuration.
 */

/**
 * Security check result
 */
export interface SecurityCheckResult {
  passed: boolean
  level: 'error' | 'warning' | 'info'
  message: string
  recommendation?: string
}

/**
 * Check if webhook signature verification is enabled
 */
export function checkWebhookSecurity(): SecurityCheckResult[] {
  const results: SecurityCheckResult[] = []
  let event
  try { event = useEvent() } catch {}
  const config = event ? useRuntimeConfig(event) : useRuntimeConfig()

  // Check Slack signing secret
  const slackSigningSecret = config.slackSigningSecret as string | undefined
  if (!slackSigningSecret) {
    results.push({
      passed: false,
      level: 'warning',
      message: 'SLACK_SIGNING_SECRET not configured',
      recommendation: 'Set SLACK_SIGNING_SECRET environment variable to enable Slack webhook signature verification. This prevents unauthorized webhook requests.',
    })
  }
  else {
    results.push({
      passed: true,
      level: 'info',
      message: 'Slack webhook signature verification enabled',
    })
  }

  // Check Mailgun signing key
  const mailgunSigningKey = config.mailgunSigningKey as string | undefined
  if (!mailgunSigningKey) {
    results.push({
      passed: false,
      level: 'warning',
      message: 'MAILGUN_SIGNING_KEY not configured',
      recommendation: 'Set MAILGUN_SIGNING_KEY environment variable to enable Mailgun webhook signature verification. This prevents unauthorized webhook requests.',
    })
  }
  else {
    results.push({
      passed: true,
      level: 'info',
      message: 'Mailgun webhook signature verification enabled',
    })
  }

  return results
}

/**
 * Check if secrets are properly configured (not default/placeholder values)
 */
export function checkSecretConfiguration(): SecurityCheckResult[] {
  const results: SecurityCheckResult[] = []

  // List of environment variables to check
  const secrets = [
    { key: 'SLACK_CLIENT_SECRET', name: 'Slack client secret' },
    { key: 'SLACK_SIGNING_SECRET', name: 'Slack signing secret' },
    { key: 'MAILGUN_SIGNING_KEY', name: 'Mailgun signing key' },
    { key: 'NUXT_SESSION_PASSWORD', name: 'Session password' },
  ]

  for (const secret of secrets) {
    const value = process.env[secret.key]

    if (!value) {
      continue // Already checked in other functions
    }

    // Check for placeholder values
    if (value === 'XXXXXXXX' || value === 'changeme' || value === 'test' || value.length < 10) {
      results.push({
        passed: false,
        level: 'error',
        message: `${secret.name} appears to be a placeholder or weak value`,
        recommendation: `Update ${secret.key} with a proper secret value. Do not use placeholder values in production.`,
      })
    }
  }

  return results
}

/**
 * Check if session configuration is secure
 */
export function checkSessionSecurity(): SecurityCheckResult[] {
  const results: SecurityCheckResult[] = []
  const sessionPassword = process.env.NUXT_SESSION_PASSWORD

  if (!sessionPassword) {
    results.push({
      passed: false,
      level: 'error',
      message: 'NUXT_SESSION_PASSWORD not configured',
      recommendation: 'Set NUXT_SESSION_PASSWORD to a random 32+ character string. This is required for secure session encryption.',
    })
  }
  else if (sessionPassword.length < 32) {
    results.push({
      passed: false,
      level: 'error',
      message: 'NUXT_SESSION_PASSWORD is too short',
      recommendation: 'Session password must be at least 32 characters for security. Generate a random string.',
    })
  }
  else {
    results.push({
      passed: true,
      level: 'info',
      message: 'Session security properly configured',
    })
  }

  return results
}

/**
 * Check if running in production mode with proper security
 */
export function checkProductionSecurity(): SecurityCheckResult[] {
  const results: SecurityCheckResult[] = []
  const isProduction = process.env.NODE_ENV === 'production'

  if (isProduction) {
    // In production, all security features should be enabled
    const webhookChecks = checkWebhookSecurity()
    const failedWebhooks = webhookChecks.filter(c => !c.passed)

    if (failedWebhooks.length > 0) {
      results.push({
        passed: false,
        level: 'error',
        message: 'Production environment detected but webhook security not fully configured',
        recommendation: 'Configure all webhook signing secrets (SLACK_SIGNING_SECRET, MAILGUN_SIGNING_KEY) in production for security.',
      })
    }

    // Check for development/test secrets in production
    const secrets = [
      process.env.SLACK_CLIENT_SECRET,
      process.env.NUXT_SESSION_PASSWORD,
    ]

    for (const secret of secrets) {
      if (secret && (secret.includes('test') || secret.includes('dev') || secret === 'XXXXXXXX')) {
        results.push({
          passed: false,
          level: 'error',
          message: 'Development/test secrets detected in production environment',
          recommendation: 'Use production-grade secrets in production. Never use test/development values.',
        })
        break
      }
    }
  }

  return results
}

/**
 * Run all security checks and return results
 */
export function runSecurityChecks(): {
  passed: boolean
  errors: SecurityCheckResult[]
  warnings: SecurityCheckResult[]
  info: SecurityCheckResult[]
  summary: string
} {
  const allChecks = [
    ...checkWebhookSecurity(),
    ...checkSecretConfiguration(),
    ...checkSessionSecurity(),
    ...checkProductionSecurity(),
  ]

  const errors = allChecks.filter(c => c.level === 'error' && !c.passed)
  const warnings = allChecks.filter(c => c.level === 'warning' && !c.passed)
  const info = allChecks.filter(c => c.level === 'info' && c.passed)

  const passed = errors.length === 0
  const summary = passed
    ? `Security checks passed (${info.length} checks, ${warnings.length} warnings)`
    : `Security checks failed (${errors.length} errors, ${warnings.length} warnings)`

  return {
    passed,
    errors,
    warnings,
    info,
    summary,
  }
}

