/**
 * Email Classification Utility
 *
 * Classifies incoming Figma emails into different message types
 * based on subject lines, sender addresses, and content patterns.
 */

export type FigmaEmailType =
  | 'comment'
  | 'account-verification'
  | 'password-reset'
  | 'invitation'
  | 'notification'
  | 'other'

export interface EmailClassificationResult {
  messageType: FigmaEmailType
  confidence: number // 0-1, how confident we are in the classification
  reason: string // Why we classified it this way
}

export interface EmailToClassify {
  from: string
  to: string
  subject: string
  htmlBody?: string
  textBody?: string
}

/**
 * Classifies a Figma email based on subject line, sender, and content
 *
 * @param email - The email to classify
 * @returns Classification result with message type, confidence, and reason
 *
 * @example
 * const result = classifyFigmaEmail({
 *   from: 'no-reply@figma.com',
 *   to: 'bot@example.com',
 *   subject: 'Verify your Figma account',
 *   htmlBody: '<html>Please verify...</html>'
 * })
 * // Returns: { messageType: 'account-verification', confidence: 0.95, reason: 'Subject contains verification keywords' }
 */
export function classifyFigmaEmail(email: EmailToClassify): EmailClassificationResult {
  const { from, subject, htmlBody = '', textBody = '' } = email
  const subjectLower = subject.toLowerCase()
  const fromLower = from.toLowerCase()
  const content = (htmlBody + textBody).toLowerCase()

  // Priority 1: Account verification emails
  if (isAccountVerification(subjectLower, content)) {
    return {
      messageType: 'account-verification',
      confidence: 0.95,
      reason: 'Subject or content contains account verification keywords'
    }
  }

  // Priority 2: Password reset emails
  if (isPasswordReset(subjectLower, content)) {
    return {
      messageType: 'password-reset',
      confidence: 0.95,
      reason: 'Subject or content contains password reset keywords'
    }
  }

  // Priority 3: Comment emails (existing flow)
  if (isComment(subjectLower, fromLower, content)) {
    return {
      messageType: 'comment',
      confidence: 0.9,
      reason: 'Email contains comment-related keywords or patterns'
    }
  }

  // Priority 4: Invitation emails
  if (isInvitation(subjectLower, content)) {
    return {
      messageType: 'invitation',
      confidence: 0.85,
      reason: 'Subject or content contains invitation keywords'
    }
  }

  // Priority 5: Notification emails
  if (isNotification(subjectLower, fromLower)) {
    return {
      messageType: 'notification',
      confidence: 0.7,
      reason: 'General notification from Figma'
    }
  }

  // Default: Other/unknown
  return {
    messageType: 'other',
    confidence: 0.5,
    reason: 'Could not match any known email patterns'
  }
}

/**
 * Check if email is an account verification email
 */
function isAccountVerification(subject: string, content: string): boolean {
  const verificationPatterns = [
    'verify your',
    'verify email',
    'verify account',
    'confirm your email',
    'confirm your account',
    'activate your account',
    'email verification',
    'account verification'
  ]

  return verificationPatterns.some(pattern =>
    subject.includes(pattern) || content.includes(pattern)
  )
}

/**
 * Check if email is a password reset email
 */
function isPasswordReset(subject: string, content: string): boolean {
  const resetPatterns = [
    'reset your password',
    'password reset',
    'forgot your password',
    'forgot password',
    'reset password',
    'change your password',
    'password recovery'
  ]

  return resetPatterns.some(pattern =>
    subject.includes(pattern) || content.includes(pattern)
  )
}

/**
 * Check if email is a comment notification
 */
function isComment(subject: string, from: string, content: string): boolean {
  const commentPatterns = [
    'commented on',
    'left a comment',
    'new comment',
    'replied to',
    'mentioned you',
    '@mentioned',
    'comment in',
    'discussion in'
  ]

  // Check if from Figma comments domain
  // Figma uses: comments-{id}@email.figma.com for comment notifications
  const isFromComments = from.includes('comments-') && from.includes('@email.figma.com')

  // Check subject/content for comment patterns
  const hasCommentPattern = commentPatterns.some(pattern =>
    subject.includes(pattern) || content.includes(pattern)
  )

  return isFromComments && hasCommentPattern
}

/**
 * Check if email is an invitation
 */
function isInvitation(subject: string, content: string): boolean {
  const invitationPatterns = [
    'invited you',
    'invitation to',
    'join the team',
    'join our team',
    'has invited you',
    'you\'re invited',
    'invited to view',
    'shared a file',
    'shared with you'
  ]

  return invitationPatterns.some(pattern =>
    subject.includes(pattern) || content.includes(pattern)
  )
}

/**
 * Check if email is a general notification
 */
function isNotification(subject: string, from: string): boolean {
  const notificationPatterns = [
    'notification',
    'update',
    'reminder',
    'alert',
    'figma news',
    'announcement'
  ]

  // From Figma domain
  const isFromFigma = from.includes('@figma.com')

  // Has notification keywords
  const hasNotificationPattern = notificationPatterns.some(pattern =>
    subject.includes(pattern)
  )

  return isFromFigma && hasNotificationPattern
}

/**
 * Batch classify multiple emails
 * Useful for processing inbox backlog
 *
 * @param emails - Array of emails to classify
 * @returns Array of classification results
 */
export function classifyEmails(emails: EmailToClassify[]): EmailClassificationResult[] {
  return emails.map(classifyFigmaEmail)
}

/**
 * Get a human-readable description of a message type
 * Useful for UI display
 */
export function getMessageTypeDescription(messageType: FigmaEmailType): string {
  const descriptions: Record<FigmaEmailType, string> = {
    'comment': 'Figma comment or mention',
    'account-verification': 'Account verification email',
    'password-reset': 'Password reset request',
    'invitation': 'Team or file invitation',
    'notification': 'General notification',
    'other': 'Other email type'
  }

  return descriptions[messageType]
}

/**
 * Get an icon name for a message type
 * Useful for UI display (Nuxt UI icon names)
 */
export function getMessageTypeIcon(messageType: FigmaEmailType): string {
  const icons: Record<FigmaEmailType, string> = {
    'comment': 'i-lucide-message-square',
    'account-verification': 'i-lucide-shield-check',
    'password-reset': 'i-lucide-lock',
    'invitation': 'i-lucide-user-plus',
    'notification': 'i-lucide-bell',
    'other': 'i-lucide-mail'
  }

  return icons[messageType]
}

/**
 * Check if a message type should be forwarded to the config owner
 * Critical emails like verification and password resets should be forwarded
 */
export function shouldForwardEmail(messageType: FigmaEmailType): boolean {
  const forwardableTypes: FigmaEmailType[] = [
    'account-verification',
    'password-reset'
  ]

  return forwardableTypes.includes(messageType)
}
