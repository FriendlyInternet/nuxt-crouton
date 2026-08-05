/**
 * Booking Email Service
 *
 * Complete email sending service for crouton-bookings that:
 * 1. Fetches active templates by triggerType
 * 2. Replaces template variables with booking data
 * 3. Sends via configured email provider
 * 4. Logs results to emaillogs collection
 *
 * Required setup:
 * - Enable: runtimeConfig.croutonBookings.email.enabled = true
 * - Install: @fyit/crouton-email (or implement custom email provider)
 * - Generate: email-template and email-log collections
 */
import { eq, and, inArray } from 'drizzle-orm'
import { useNitroApp } from 'nitropack/runtime'
import {
  isBookingEmailEnabled,
  getBookingEmailService,
  renderBookingEmailTemplate,
  formatBookingEmailDate,
  resolveTranslatedField,
  type BookingEmailTriggerType,
  type BookingEmailResult,
  type BookingEmailVariables,
  type BookingWithEmailContext
} from './booking-emails'

/**
 * Email template record shape (from generated bookingsEmailtemplates table)
 */
interface BookingEmailTemplateRecord {
  id: string
  teamId: string
  triggerType: string
  subject: string
  body: string
  recipientType?: string | null
  fromEmail?: string | null
  isActive: boolean
  locationId?: string | null
  daysOffset?: number | null
  translations?: Record<string, Record<string, string>> | null
}

/**
 * Extended booking context with team information
 */
export interface BookingEmailContext extends BookingWithEmailContext {
  teamName?: string
  teamEmail?: string
  teamPhone?: string
  /** Pre-resolved slot label (e.g., "14:00 - 15:00" instead of raw slot ID) */
  slotLabel?: string
}

/**
 * Email send options
 */
export interface SendBookingEmailOptions {
  booking: BookingEmailContext
  triggerType: BookingEmailTriggerType
  teamId: string
  userId: string
  /** Override recipient email (default: uses booking owner's email) */
  recipientEmail?: string
  /** Admin email for 'admin' or 'both' recipient types */
  adminEmail?: string
  /** Locale for translations and date formatting (default: 'en') */
  locale?: string
  /** H3 event — required on Cloudflare Workers for runtimeConfig access */
  event?: any
}

/**
 * Result from sending booking email(s)
 */
export interface SendBookingEmailsResult {
  success: boolean
  customerResult?: BookingEmailResult
  adminResult?: BookingEmailResult
  errors?: string[]
}

/**
 * Get active email templates for a trigger type
 */
export async function getActiveTemplatesForTrigger(
  teamId: string,
  triggerType: BookingEmailTriggerType,
  locationId?: string | null
): Promise<BookingEmailTemplateRecord[]> {
  // Early return if email is not enabled
  if (!isBookingEmailEnabled()) {
    return []
  }

  const db = useDB()

  try {
    // Import from the centralized schema index (always exists, Vite resolves ~~ alias)
    // Tables are generated at build time — schema typed as Record since exports vary per app
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- schema exports are generated per consuming app at build time; unknowable in the package
    const schema: Record<string, any> = await import('~~/server/db/schema')
    const bookingsEmailtemplates = schema.bookingsEmailtemplates
    if (!bookingsEmailtemplates) return []

    // Build conditions
    const conditions = [
      eq(bookingsEmailtemplates.teamId as any, teamId),
      eq(bookingsEmailtemplates.triggerType as any, triggerType),
      eq(bookingsEmailtemplates.isActive as any, true)
    ]

    const templates = await db
      .select()
      .from(bookingsEmailtemplates)
      .where(and(...conditions))

    // Filter by location: return templates that match the location OR have no location set
    if (locationId) {
      return templates.filter(
        (t: any) => !t.locationId || t.locationId === locationId
      )
    }

    return templates
  }
  catch (error) {
    console.error('[booking-email] Failed to fetch templates:', error)
    return []
  }
}

/**
 * Build email variables from booking context.
 *
 * Returns all template variables (basic + location parts) — the previous
 * `buildExtendedEmailVariables` split was a vestige; the only production
 * caller always wanted the full set.
 */
export function buildEmailVariables(
  booking: BookingEmailContext,
  locale?: string
): BookingEmailVariables {
  const locationData = booking.locationData
  const ownerUser = booking.ownerUser

  // Build full address: prefer street+city parts, fall back to pre-built address
  let locationAddress = ''
  if (locationData) {
    const streetCity = [locationData.street, locationData.city].filter(Boolean)
    locationAddress = streetCity.length > 0
      ? streetCity.join(', ')
      : (locationData.address || '')
  }

  return {
    customer_name: ownerUser?.name || 'Customer',
    customer_email: ownerUser?.email || '',
    booking_date: formatBookingEmailDate(booking.date, locale),
    booking_slot: booking.slotLabel
      || (Array.isArray(booking.slot) ? booking.slot.join(', ') : booking.slot || 'Not specified'),
    booking_reference: booking.id,
    location_name: locationData?.name || 'Location',
    location_title: locationData?.title || locationData?.name || 'Location',
    location_street: locationData?.street || '',
    location_city: locationData?.city || '',
    location_address: locationAddress,
    location_content: locationData?.content || '',
    team_name: booking.teamName || 'Your Team',
    team_email: booking.teamEmail || '',
    team_phone: booking.teamPhone || ''
  }
}

/**
 * Log email send attempt to emaillogs collection
 */
export async function logEmailSend(options: {
  teamId: string
  userId: string
  bookingId: string
  templateId: string
  recipientEmail: string
  triggerType: string
  status: 'pending' | 'sent' | 'failed'
  error?: string
}): Promise<string | null> {
  // Early return if email is not enabled
  if (!isBookingEmailEnabled()) {
    return null
  }

  const db = useDB()

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- schema exports are generated per consuming app at build time; unknowable in the package
    const schema: Record<string, any> = await import('~~/server/db/schema')
    const bookingsEmaillogs = schema.bookingsEmaillogs
    if (!bookingsEmaillogs) return null

    const [log] = await db
      .insert(bookingsEmaillogs)
      .values({
        teamId: options.teamId,
        owner: options.userId,
        bookingId: options.bookingId,
        templateId: options.templateId,
        recipientEmail: options.recipientEmail,
        triggerType: options.triggerType,
        status: options.status,
        sentAt: options.status === 'sent' ? new Date().toISOString() : null,
        error: options.error || null,
        createdBy: options.userId,
        updatedBy: options.userId
      })
      .returning()

    return log?.id || null
  }
  catch (error) {
    console.error('[booking-email] Failed to log email send:', error)
    return null
  }
}

/**
 * Update email log status
 */
export async function updateEmailLogStatus(
  logId: string,
  status: 'sent' | 'failed',
  error?: string
): Promise<void> {
  // Early return if email is not enabled
  if (!isBookingEmailEnabled()) {
    return
  }

  const db = useDB()

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- schema exports are generated per consuming app at build time; unknowable in the package
    const schema: Record<string, any> = await import('~~/server/db/schema')
    const bookingsEmaillogs = schema.bookingsEmaillogs
    if (!bookingsEmaillogs) return

    await db
      .update(bookingsEmaillogs)
      .set({
        status,
        sentAt: status === 'sent' ? new Date().toISOString() : null,
        error: error || null
      })
      .where(eq(bookingsEmaillogs.id as any, logId))
  }
  catch (error) {
    console.error('[booking-email] Failed to update email log:', error)
  }
}

/**
 * Render booking email template with variables
 */
export function renderBookingEmail(
  template: { subject: string; body: string },
  variables: BookingEmailVariables
): { subject: string; body: string } {
  // Extend the base render function to handle all variable formats
  const allVariables = {
    ...variables,
    // Also support underscore format for backwards compatibility
    location_address: variables.location_address || [
      variables.location_street,
      variables.location_city
    ].filter(Boolean).join(', ')
  }

  return {
    subject: renderBookingEmailTemplate(template.subject, allVariables),
    body: renderBookingEmailTemplate(template.body, allVariables)
  }
}

/**
 * Custom email provider type for apps that don't use crouton-email
 */
export interface CustomEmailProvider {
  send(options: {
    to: string
    subject: string
    html: string
    from?: string
  }): Promise<{ success: boolean; id?: string; error?: string }>
}

// Global storage for custom email provider
let _customEmailProvider: CustomEmailProvider | null = null

/**
 * Register a custom email provider
 *
 * Use this in a Nitro plugin to provide your own email sending implementation.
 *
 * @example
 * // server/plugins/email.ts
 * import { registerEmailProvider } from '@fyit/crouton-bookings/server/utils/email-service'
 * import { Resend } from 'resend'
 *
 * export default defineNitroPlugin(() => {
 *   const resend = new Resend(process.env.RESEND_API_KEY)
 *
 *   registerEmailProvider({
 *     async send({ to, subject, html, from }) {
 *       const { data, error } = await resend.emails.send({
 *         from: from || 'noreply@example.com',
 *         to,
 *         subject,
 *         html
 *       })
 *       return { success: !error, id: data?.id, error: error?.message }
 *     }
 *   })
 * })
 */
export function registerEmailProvider(provider: CustomEmailProvider): void {
  _customEmailProvider = provider
}

/**
 * Get the configured email provider (custom or crouton-email)
 */
async function getEmailProvider(event?: any): Promise<CustomEmailProvider | null> {
  // Check for custom provider first
  if (_customEmailProvider) {
    return _customEmailProvider
  }

  // Fall back to crouton-email if available
  const croutonEmailService = await getBookingEmailService(event)
  if (croutonEmailService) {
    return {
      async send(options) {
        return croutonEmailService.sendEmail(options)
      }
    }
  }

  return null
}

/**
 * Send a single email using the configured email provider
 */
async function sendSingleEmail(options: {
  to: string
  subject: string
  html: string
  from?: string
}, event?: any): Promise<{ success: boolean; error?: string }> {
  const provider = await getEmailProvider(event)

  if (!provider) {
    console.warn('[booking-email] No email provider configured. Either register a custom provider or install @fyit/crouton-email.')
    return {
      success: false,
      error: 'No email provider configured. Either register a custom provider or install @fyit/crouton-email.'
    }
  }

  console.log('[booking-email] Sending email to:', options.to, '| Subject:', options.subject)

  try {
    const result = await provider.send({
      to: options.to,
      subject: options.subject,
      html: options.html,
      from: options.from
    })

    if (result.success) {
      console.log('[booking-email] ✓ Email sent successfully to:', options.to)
    } else {
      console.error('[booking-email] ✗ Email failed:', result.error)
    }

    return {
      success: result.success,
      error: result.error
    }
  }
  catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to send email'
    console.error('[booking-email] ✗ Email exception:', message)
    return {
      success: false,
      error: message
    }
  }
}

/**
 * Send booking email(s) for a specific trigger
 *
 * This is the main entry point for sending booking-related emails.
 * It handles:
 * - Finding active templates for the trigger type
 * - Building email variables from booking data
 * - Sending to customer, admin, or both based on template config
 * - Logging all send attempts
 * - Emitting crouton:operation hooks for observability
 */
export async function sendBookingEmails(
  options: SendBookingEmailOptions
): Promise<SendBookingEmailsResult> {
  // Check if email is enabled
  if (!isBookingEmailEnabled()) {
    return {
      success: false,
      errors: ['Email module is not enabled']
    }
  }

  const { booking, triggerType, teamId, userId, adminEmail, locale, event: h3Event } = options
  const nitroApp = useNitroApp()

  // Get templates for this trigger
  const templates = await getActiveTemplatesForTrigger(
    teamId,
    triggerType,
    booking.location
  )

  if (templates.length === 0) {
    console.warn(`[booking-email] No active templates found for trigger: ${triggerType} (team: ${teamId})`)
    return {
      success: true,
      errors: [`No active templates found for trigger: ${triggerType}`]
    }
  }

  // Build email variables (locale-aware date formatting)
  const variables = buildEmailVariables(booking, locale)

  const results: SendBookingEmailsResult = {
    success: true,
    errors: []
  }

  // Process each matching template
  for (const template of templates) {
    // Resolve translated subject/body when locale is provided
    const tr = template.translations as Record<string, Record<string, string>> | null
    const resolvedSubject = locale ? resolveTranslatedField(template.subject, tr, 'subject', locale) : template.subject
    const resolvedBody = locale ? resolveTranslatedField(template.body, tr, 'body', locale) : template.body

    const { subject, body } = renderBookingEmail(
      { subject: resolvedSubject, body: resolvedBody },
      variables
    )

    const recipientType = template.recipientType || 'customer'

    // Send to customer
    if (recipientType === 'customer' || recipientType === 'both') {
      const customerEmail = options.recipientEmail || variables.customer_email

      if (customerEmail) {
        // Log pending
        const logId = await logEmailSend({
          teamId,
          userId,
          bookingId: booking.id,
          templateId: template.id,
          recipientEmail: customerEmail,
          triggerType,
          status: 'pending'
        })

        // Send
        const result = await sendSingleEmail({
          to: customerEmail,
          subject,
          html: body,
          from: template.fromEmail || undefined
        }, h3Event)

        // Update log
        if (logId) {
          await updateEmailLogStatus(
            logId,
            result.success ? 'sent' : 'failed',
            result.error
          )
        }

        // Emit operation hook for observability
        nitroApp.hooks.callHook('crouton:operation', {
          type: result.success ? 'booking:email-sent' : 'booking:email-failed',
          source: 'crouton-bookings',
          teamId,
          userId,
          metadata: {
            bookingId: booking.id,
            recipient: customerEmail,
            recipientType: 'customer',
            template: triggerType,
            status: result.success ? 'sent' : 'failed',
            templateId: template.id,
            emailLogId: logId || undefined,
            error: result.error,
          },
        }).catch(() => {})

        results.customerResult = {
          success: result.success,
          sent: result.success,
          templateId: template.id,
          emailLogId: logId || undefined,
          error: result.error
        }

        if (!result.success) {
          results.success = false
          results.errors?.push(`Customer email failed: ${result.error}`)
        }
      }
      else {
        results.errors?.push('No customer email available')
      }
    }

    // Send to admin
    if ((recipientType === 'admin' || recipientType === 'both') && adminEmail) {
      // Log pending
      const logId = await logEmailSend({
        teamId,
        userId,
        bookingId: booking.id,
        templateId: template.id,
        recipientEmail: adminEmail,
        triggerType,
        status: 'pending'
      })

      // Send
      const result = await sendSingleEmail({
        to: adminEmail,
        subject: `[Admin] ${subject}`,
        html: body,
        from: template.fromEmail || undefined
      }, h3Event)

      // Update log
      if (logId) {
        await updateEmailLogStatus(
          logId,
          result.success ? 'sent' : 'failed',
          result.error
        )
      }

      // Emit operation hook for observability
      nitroApp.hooks.callHook('crouton:operation', {
        type: result.success ? 'booking:email-sent' : 'booking:email-failed',
        source: 'crouton-bookings',
        teamId,
        userId,
        metadata: {
          bookingId: booking.id,
          recipient: adminEmail,
          recipientType: 'admin',
          template: triggerType,
          status: result.success ? 'sent' : 'failed',
          templateId: template.id,
          emailLogId: logId || undefined,
          error: result.error,
        },
      }).catch(() => {})

      results.adminResult = {
        success: result.success,
        sent: result.success,
        templateId: template.id,
        emailLogId: logId || undefined,
        error: result.error
      }

      if (!result.success) {
        results.success = false
        results.errors?.push(`Admin email failed: ${result.error}`)
      }
    }
  }

  return results
}

/**
 * Trigger booking_created emails
 *
 * Call this after a new booking is created.
 */
export async function triggerBookingCreatedEmail(
  booking: BookingEmailContext,
  teamId: string,
  userId: string,
  adminEmail?: string,
  locale?: string,
  event?: any
): Promise<SendBookingEmailsResult> {
  return sendBookingEmails({
    booking,
    triggerType: 'booking_created',
    teamId,
    userId,
    adminEmail,
    locale,
    event
  })
}

/**
 * Trigger booking_cancelled emails
 *
 * Call this when a booking is cancelled.
 */
export async function triggerBookingCancelledEmail(
  booking: BookingEmailContext,
  teamId: string,
  userId: string,
  adminEmail?: string,
  locale?: string,
  event?: any
): Promise<SendBookingEmailsResult> {
  return sendBookingEmails({
    booking,
    triggerType: 'booking_cancelled',
    teamId,
    userId,
    adminEmail,
    locale,
    event
  })
}

/**
 * D1 has a 100-parameter limit per query. Chunk arrays to stay under the limit.
 * Reserve 5 params for non-array conditions (e.g. teamId, isActive).
 */
const D1_PARAM_CHUNK_SIZE = 95

function chunkArray<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = []
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size))
  }
  return chunks
}

/**
 * Get email statistics for multiple bookings in a single query
 */
export async function getBatchBookingEmailStats(
  bookingIds: string[],
  teamId: string
): Promise<Map<string, { total: number; sent: number; pending: number; failed: number }>> {
  const defaultStats = { total: 0, sent: 0, pending: 0, failed: 0 }

  if (!isBookingEmailEnabled() || bookingIds.length === 0) {
    return new Map()
  }

  const db = useDB()

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- schema exports are generated per consuming app at build time; unknowable in the package
    const schema: Record<string, any> = await import('~~/server/db/schema')
    const bookingsEmaillogs = schema.bookingsEmaillogs
    if (!bookingsEmaillogs) return new Map()

    // D1 has a 100-parameter limit — chunk the IDs
    const chunks = chunkArray(bookingIds, D1_PARAM_CHUNK_SIZE)
    const allLogs: Array<{ bookingId: string; status: string }> = []

    for (const chunk of chunks) {
      const logs = await db
        .select({
          bookingId: bookingsEmaillogs.bookingId,
          status: bookingsEmaillogs.status
        })
        .from(bookingsEmaillogs)
        .where(
          and(
            inArray(bookingsEmaillogs.bookingId, chunk),
            eq(bookingsEmaillogs.teamId as any, teamId)
          )
        )
      allLogs.push(...logs)
    }

    // Group by bookingId
    const statsMap = new Map<string, { total: number; sent: number; pending: number; failed: number }>()
    for (const log of allLogs) {
      const stats = statsMap.get(log.bookingId) ?? { ...defaultStats }
      stats.total++
      if (log.status === 'sent') stats.sent++
      else if (log.status === 'pending') stats.pending++
      else if (log.status === 'failed') stats.failed++
      statsMap.set(log.bookingId, stats)
    }

    return statsMap
  }
  catch (error) {
    console.error('[booking-email] Failed to get batch email stats:', error)
    return new Map()
  }
}

/**
 * Get detailed email status per trigger type for multiple bookings in batch
 */
export async function getBatchBookingEmailDetails(
  bookings: Array<{ id: string; date: string | Date; createdAt?: string | Date | null }>,
  teamId: string
): Promise<Map<string, EmailTriggerStatusResult[]>> {
  if (!isBookingEmailEnabled() || bookings.length === 0) {
    return new Map()
  }

  const db = useDB()
  const bookingIds = bookings.map(b => b.id)

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- schema exports are generated per consuming app at build time; unknowable in the package
    const schema: Record<string, any> = await import('~~/server/db/schema')
    const bookingsEmaillogs = schema.bookingsEmaillogs
    const bookingsEmailtemplates = schema.bookingsEmailtemplates
    if (!bookingsEmaillogs || !bookingsEmailtemplates) return new Map()

    // D1 has a 100-parameter limit — chunk the booking IDs
    const chunks = chunkArray(bookingIds, D1_PARAM_CHUNK_SIZE)

    // Fetch templates in parallel with the first chunk of logs
    const [firstChunkLogs, templates] = await Promise.all([
      chunks.length > 0
        ? db
            .select({
              bookingId: bookingsEmaillogs.bookingId,
              triggerType: bookingsEmaillogs.triggerType,
              status: bookingsEmaillogs.status,
              sentAt: bookingsEmaillogs.sentAt,
            })
            .from(bookingsEmaillogs)
            .where(
              and(
                inArray(bookingsEmaillogs.bookingId as any, chunks[0]!),
                eq(bookingsEmaillogs.teamId as any, teamId)
              )
            )
        : Promise.resolve([]),
      // Single query for templates (shared across all bookings in the team)
      db
        .select({
          triggerType: bookingsEmailtemplates.triggerType,
          daysOffset: bookingsEmailtemplates.daysOffset,
        })
        .from(bookingsEmailtemplates)
        .where(
          and(
            eq(bookingsEmailtemplates.teamId as any, teamId),
            eq(bookingsEmailtemplates.isActive as any, true)
          )
        )
    ])

    // Fetch remaining chunks
    const allLogs = [...firstChunkLogs]
    for (let i = 1; i < chunks.length; i++) {
      const logs = await db
        .select({
          bookingId: bookingsEmaillogs.bookingId,
          triggerType: bookingsEmaillogs.triggerType,
          status: bookingsEmaillogs.status,
          sentAt: bookingsEmaillogs.sentAt,
        })
        .from(bookingsEmaillogs)
        .where(
          and(
            inArray(bookingsEmaillogs.bookingId as any, chunks[i]!),
            eq(bookingsEmaillogs.teamId as any, teamId)
          )
        )
      allLogs.push(...logs)
    }

    // Group logs by bookingId
    const logsByBooking = new Map<string, typeof allLogs>()
    for (const log of allLogs) {
      const existing = logsByBooking.get(log.bookingId) ?? []
      existing.push(log)
      logsByBooking.set(log.bookingId, existing)
    }

    // Template flags (shared for all bookings)
    const hasConfirmationTemplate = templates.some((t: any) => t.triggerType === 'booking_created')
    const reminderTemplate = templates.find((t: any) => t.triggerType === 'reminder_before')
    const hasCancelTemplate = templates.some((t: any) => t.triggerType === 'booking_cancelled')
    const followUpTemplate = templates.find((t: any) => t.triggerType === 'follow_up_after')

    // Build results per booking
    const detailsMap = new Map<string, EmailTriggerStatusResult[]>()

    for (const booking of bookings) {
      const logs = logsByBooking.get(booking.id) ?? []
      const results: EmailTriggerStatusResult[] = []
      const bookingDate = new Date(booking.date)

      // Confirmation (booking_created)
      const confirmationLog = logs.find(l => l.triggerType === 'booking_created')
      if (confirmationLog) {
        results.push({
          triggerType: 'booking_created',
          status: confirmationLog.status as EmailTriggerStatusResult['status'],
          sentAt: confirmationLog.sentAt || null,
        })
      } else if (hasConfirmationTemplate) {
        results.push({
          triggerType: 'booking_created',
          status: 'not_sent',
          scheduledFor: booking.createdAt ? new Date(booking.createdAt).toISOString() : null,
        })
      }

      // Reminder (reminder_before)
      const reminderLog = logs.find(l => l.triggerType === 'reminder_before')
      if (reminderLog) {
        results.push({
          triggerType: 'reminder_before',
          status: reminderLog.status as EmailTriggerStatusResult['status'],
          sentAt: reminderLog.sentAt || null,
        })
      } else if (reminderTemplate) {
        const daysOffset = Math.abs(reminderTemplate.daysOffset || 1)
        const scheduledDate = new Date(bookingDate)
        scheduledDate.setDate(scheduledDate.getDate() - daysOffset)
        results.push({
          triggerType: 'reminder_before',
          status: 'not_sent',
          scheduledFor: scheduledDate.toISOString(),
        })
      }

      // Cancellation (booking_cancelled)
      const cancelLog = logs.find(l => l.triggerType === 'booking_cancelled')
      if (cancelLog || hasCancelTemplate) {
        results.push({
          triggerType: 'booking_cancelled',
          status: cancelLog?.status as EmailTriggerStatusResult['status'] || 'not_sent',
          sentAt: cancelLog?.sentAt || null,
        })
      }

      // Follow-up (follow_up_after)
      const followUpLog = logs.find(l => l.triggerType === 'follow_up_after')
      if (followUpLog) {
        results.push({
          triggerType: 'follow_up_after',
          status: followUpLog.status as EmailTriggerStatusResult['status'],
          sentAt: followUpLog.sentAt || null,
        })
      } else if (followUpTemplate) {
        const daysOffset = Math.abs(followUpTemplate.daysOffset || 1)
        const scheduledDate = new Date(bookingDate)
        scheduledDate.setDate(scheduledDate.getDate() + daysOffset)
        results.push({
          triggerType: 'follow_up_after',
          status: 'not_sent',
          scheduledFor: scheduledDate.toISOString(),
        })
      }

      detailsMap.set(booking.id, results)
    }

    return detailsMap
  }
  catch (error) {
    console.error('[booking-email] Failed to get batch email details:', error)
    return new Map()
  }
}

/**
 * Get email statistics for a booking
 */
export async function getBookingEmailStats(
  bookingId: string,
  teamId: string
): Promise<{ total: number; sent: number; pending: number; failed: number }> {
  // Early return if email is not enabled
  if (!isBookingEmailEnabled()) {
    return { total: 0, sent: 0, pending: 0, failed: 0 }
  }

  const db = useDB()

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- schema exports are generated per consuming app at build time; unknowable in the package
    const schema: Record<string, any> = await import('~~/server/db/schema')
    const bookingsEmaillogs = schema.bookingsEmaillogs
    if (!bookingsEmaillogs) return { total: 0, sent: 0, pending: 0, failed: 0 }

    const logs = await db
      .select({
        status: bookingsEmaillogs.status
      })
      .from(bookingsEmaillogs)
      .where(
        and(
          eq(bookingsEmaillogs.bookingId as any, bookingId),
          eq(bookingsEmaillogs.teamId as any, teamId)
        )
      )

    return {
      total: logs.length,
      sent: logs.filter((l: any) => l.status === 'sent').length,
      pending: logs.filter((l: any) => l.status === 'pending').length,
      failed: logs.filter((l: any) => l.status === 'failed').length
    }
  }
  catch (error) {
    console.error('[booking-email] Failed to get email stats:', error)
    return { total: 0, sent: 0, pending: 0, failed: 0 }
  }
}

/**
 * Email trigger status for UI display
 */
export interface EmailTriggerStatusResult {
  triggerType: BookingEmailTriggerType
  status: 'sent' | 'pending' | 'failed' | 'not_sent'
  sentAt?: string | null
  scheduledFor?: string | null
}

/**
 * Get detailed email status per trigger type for a booking
 * Returns status for all email types with scheduled dates based on templates
 */
export async function getBookingEmailDetails(
  bookingId: string,
  teamId: string,
  bookingDate: string | Date,
  bookingCreatedAt?: string | Date | null
): Promise<EmailTriggerStatusResult[]> {
  const results: EmailTriggerStatusResult[] = []

  // Early return if email is not enabled
  if (!isBookingEmailEnabled()) {
    return results
  }

  const db = useDB()

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- schema exports are generated per consuming app at build time; unknowable in the package
    const schema: Record<string, any> = await import('~~/server/db/schema')
    const bookingsEmaillogs = schema.bookingsEmaillogs
    const bookingsEmailtemplates = schema.bookingsEmailtemplates
    if (!bookingsEmaillogs || !bookingsEmailtemplates) return results

    // Get all email logs for this booking
    const logs = await db
      .select({
        triggerType: bookingsEmaillogs.triggerType,
        status: bookingsEmaillogs.status,
        sentAt: bookingsEmaillogs.sentAt,
      })
      .from(bookingsEmaillogs)
      .where(
        and(
          eq(bookingsEmaillogs.bookingId as any, bookingId),
          eq(bookingsEmaillogs.teamId as any, teamId)
        )
      )

    // Get active templates to know scheduled dates
    const templates = await db
      .select({
        triggerType: bookingsEmailtemplates.triggerType,
        daysOffset: bookingsEmailtemplates.daysOffset,
      })
      .from(bookingsEmailtemplates)
      .where(
        and(
          eq(bookingsEmailtemplates.teamId as any, teamId),
          eq(bookingsEmailtemplates.isActive as any, true)
        )
      )

    const booking = new Date(bookingDate)
    const hasConfirmationTemplate = templates.some((t: any) => t.triggerType === 'booking_created')

    // Process confirmation (booking_created) - sent immediately when booked
    const confirmationLog = logs.find((l: any) => l.triggerType === 'booking_created')
    if (confirmationLog) {
      results.push({
        triggerType: 'booking_created',
        status: confirmationLog.status as EmailTriggerStatusResult['status'],
        sentAt: confirmationLog.sentAt || null,
      })
    } else if (hasConfirmationTemplate) {
      // Should have been sent when booking was created
      results.push({
        triggerType: 'booking_created',
        status: 'not_sent',
        scheduledFor: bookingCreatedAt ? new Date(bookingCreatedAt).toISOString() : null,
      })
    }
    // No template and no log → don't include (button won't show)

    // Process reminder (reminder_before) - sent X days before event
    const reminderLog = logs.find((l: any) => l.triggerType === 'reminder_before')
    const reminderTemplate = templates.find((t: any) => t.triggerType === 'reminder_before')

    if (reminderLog) {
      results.push({
        triggerType: 'reminder_before',
        status: reminderLog.status as EmailTriggerStatusResult['status'],
        sentAt: reminderLog.sentAt || null,
      })
    } else if (reminderTemplate) {
      // Calculate when reminder will be sent (daysOffset days before booking)
      const daysOffset = Math.abs(reminderTemplate.daysOffset || 1)
      const scheduledDate = new Date(booking)
      scheduledDate.setDate(scheduledDate.getDate() - daysOffset)

      results.push({
        triggerType: 'reminder_before',
        status: 'not_sent',
        scheduledFor: scheduledDate.toISOString(),
      })
    }
    // No template and no log → don't include

    // Process cancellation (booking_cancelled) - only if log exists or template exists
    const cancelLog = logs.find((l: any) => l.triggerType === 'booking_cancelled')
    const hasCancelTemplate = templates.some((t: any) => t.triggerType === 'booking_cancelled')
    if (cancelLog || hasCancelTemplate) {
      results.push({
        triggerType: 'booking_cancelled',
        status: cancelLog?.status as EmailTriggerStatusResult['status'] || 'not_sent',
        sentAt: cancelLog?.sentAt || null,
      })
    }

    // Process follow-up (follow_up_after) - sent X days after event
    const followUpLog = logs.find((l: any) => l.triggerType === 'follow_up_after')
    const followUpTemplate = templates.find((t: any) => t.triggerType === 'follow_up_after')

    if (followUpLog) {
      results.push({
        triggerType: 'follow_up_after',
        status: followUpLog.status as EmailTriggerStatusResult['status'],
        sentAt: followUpLog.sentAt || null,
      })
    } else if (followUpTemplate) {
      // Calculate when follow-up will be sent (daysOffset days after booking)
      const daysOffset = Math.abs(followUpTemplate.daysOffset || 1)
      const scheduledDate = new Date(booking)
      scheduledDate.setDate(scheduledDate.getDate() + daysOffset)

      results.push({
        triggerType: 'follow_up_after',
        status: 'not_sent',
        scheduledFor: scheduledDate.toISOString(),
      })
    }
    // No template and no log → don't include

    return results
  }
  catch (error) {
    console.error('[booking-email] Failed to get email details:', error)
    return results
  }
}
