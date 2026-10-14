/**
 * Resend Email Fetching Utility
 *
 * Fetches email content from Resend's Receiving API after webhook is received.
 * Resend webhooks do NOT include email body content, so we need to fetch it separately.
 *
 * @see https://resend.com/docs/api-reference/emails/retrieve-email
 */

/**
 * Resend Email API Response
 */
export interface ResendEmailResponse {
  id: string
  object: 'email'
  from: string
  to: string[]
  subject: string
  html: string | null
  text: string | null
  created_at: string
  last_event?: string
}

/**
 * Resend API Error Response
 */
export interface ResendApiError {
  statusCode: number
  message: string
  name: string
}

/**
 * Fetch email content from Resend API
 *
 * After receiving a webhook from Resend, we need to fetch the actual email content
 * because Resend webhooks don't include the body (HTML/text) for serverless optimization.
 *
 * IMPORTANT: For received/inbound emails, use the /emails/receiving/{id} endpoint,
 * NOT the /emails/{id} endpoint (which is only for sent emails).
 *
 * @param emailId - The email ID from the webhook (e.g., from webhook.data.email_id)
 * @param apiToken - Resend API token (re_...)
 * @returns The full email object with HTML and text content
 * @throws Error if API call fails or email not found
 *
 * @see https://resend.com/docs/api-reference/emails/retrieve-received-email
 *
 * @example
 * ```typescript
 * // In webhook handler
 * const webhook = await readBody(event)
 * const emailId = webhook.data.email_id
 *
 * const email = await fetchResendEmail(emailId, config.resendApiToken)
 * console.log(email.html, email.text)
 * ```
 */
export async function fetchResendEmail(
  emailId: string,
  apiToken: string
): Promise<ResendEmailResponse> {
  if (!emailId || !emailId.trim()) {
    throw new Error('Email ID is required')
  }

  if (!apiToken || !apiToken.trim()) {
    throw new Error('Resend API token is required')
  }

  try {
    // Use the /emails/receiving/{id} endpoint for received/inbound emails
    // NOT /emails/{id} which is only for sent emails
    const url = `https://api.resend.com/emails/receiving/${emailId}`
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${apiToken}`,
        'Content-Type': 'application/json',
      },
    })

    if (!response.ok) {
      // Handle Resend API errors
      let errorMessage = `Resend API error: ${response.status} ${response.statusText}`

      try {
        const errorData = await response.json() as ResendApiError
        if (errorData.message) {
          errorMessage = `Resend API error: ${errorData.message}`
        }
      } catch {
        // Unable to parse error response, use default message
      }

      throw new Error(errorMessage)
    }

    const email = await response.json() as ResendEmailResponse

    // Validate required fields
    if (!email.id || !email.from || !email.to || !email.subject) {
      throw new Error('Invalid email response from Resend API - missing required fields')
    }

    return email
  } catch (error) {
    if (error instanceof Error) {
      throw error
    }
    throw new Error(`Failed to fetch email from Resend: ${String(error)}`)
  }
}

/**
 * Transform Resend email response to Mailgun-compatible format
 *
 * This allows us to reuse the existing Figma email parser and adapter
 * without any changes - we just transform Resend's response to match
 * what Mailgun provides.
 *
 * @param resendEmail - Email from Resend API
 * @returns Mailgun-compatible email object
 *
 * @example
 * ```typescript
 * const email = await fetchResendEmail(emailId, apiToken)
 * const mailgunFormat = transformToMailgunFormat(email)
 *
 * // Now use with existing Figma adapter
 * const adapter = getAdapter('figma')
 * const parsed = await adapter.parseIncoming(mailgunFormat)
 * ```
 */
export function transformToMailgunFormat(resendEmail: ResendEmailResponse): {
  subject: string
  from: string
  recipient: string
  'body-html': string
  'body-plain': string
  'stripped-text': string
  timestamp: number
} {
  // Extract first recipient (Resend sends array, Mailgun uses single string)
  const recipient = resendEmail.to[0] || ''

  // Convert ISO 8601 timestamp to Unix timestamp (seconds)
  const timestamp = new Date(resendEmail.created_at).getTime() / 1000

  return {
    subject: resendEmail.subject,
    from: resendEmail.from,
    recipient,
    'body-html': resendEmail.html || '',
    'body-plain': resendEmail.text || '',
    'stripped-text': resendEmail.text || '', // Resend doesn't strip text, use plain text
    timestamp,
  }
}
