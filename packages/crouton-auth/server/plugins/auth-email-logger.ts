/// <reference path="../crouton-hooks.d.ts" />
/**
 * Nitro plugin that logs all auth emails to the database.
 *
 * Hooks into crouton:auth:email and persists a log entry for every email
 * dispatched through the auth system. Runs independently of crouton-email.
 */
import { and, desc, eq } from 'drizzle-orm'
import { useDB, tables } from '../utils/database'

interface AuthEmailPayload {
  type: 'verification' | 'password-reset' | 'invitation' | 'magic-link'
  to: string
  url?: string
  userName?: string
  inviterName?: string
  organizationName?: string
  role?: string
  invitationId?: string
  inviterEmail?: string
  expiresAt?: Date
}

function extractMetadata(payload: AuthEmailPayload): Record<string, string> {
  const meta: Record<string, string> = {}

  switch (payload.type) {
    case 'verification':
    case 'password-reset':
      if (payload.userName) meta.userName = payload.userName
      break
    case 'invitation':
      meta.inviterName = payload.inviterName
      meta.organizationName = payload.organizationName
      meta.role = payload.role
      break
    case 'magic-link':
      break
  }

  return meta
}

export default defineNitroPlugin((nitroApp) => {
  // Log the ATTEMPT as `pending`. The actual send happens in a separate hook
  // handler (crouton-email); it reports back via crouton:auth:email:result,
  // which flips this row to `sent` / `failed`. If no sender is installed the
  // hook never fires and the row stays `pending` — an honest "never confirmed"
  // signal instead of a false `sent` (issue #1542).
  nitroApp.hooks.hook('crouton:auth:email', async (payload) => {
    const logId = crypto.randomUUID()

    try {
      const db = useDB()

      await db.insert(tables.authEmailLog).values({
        id: logId,
        emailType: payload.type,
        recipientEmail: payload.to,
        status: 'pending',
        metadata: Object.keys(extractMetadata(payload)).length > 0
          ? extractMetadata(payload)
          : null,
        createdAt: new Date()
      })
    }
    catch (err) {
      // Logging must never break the auth/email flow
      console.error('[crouton-auth] Failed to log email:', err)
    }
  })

  // Reconcile the logged attempt with the real send outcome. Matches the most
  // recent still-`pending` row for this recipient + type (auth emails to the
  // same recipient/type in the same instant are effectively unique). A miss
  // (e.g. the result arrived before the insert) safely leaves the row
  // `pending` rather than fabricating a status.
  nitroApp.hooks.hook('crouton:auth:email:result', async ({ to, type, ok, error }) => {
    try {
      const db = useDB()

      const [row] = await db
        .select({ id: tables.authEmailLog.id })
        .from(tables.authEmailLog)
        .where(and(
          eq(tables.authEmailLog.recipientEmail, to),
          eq(tables.authEmailLog.emailType, type),
          eq(tables.authEmailLog.status, 'pending')
        ))
        .orderBy(desc(tables.authEmailLog.createdAt))
        .limit(1)

      if (!row) return

      await db
        .update(tables.authEmailLog)
        .set({
          status: ok ? 'sent' : 'failed',
          sentAt: ok ? new Date() : null,
          error: ok ? null : (error ?? 'send failed')
        })
        .where(eq(tables.authEmailLog.id, row.id))
    }
    catch (err) {
      console.error('[crouton-auth] Failed to reconcile email log:', err)
    }
  })
})
