/// <reference path="../crouton-hooks.d.ts" />
import {
  sendVerificationLink,
  sendPasswordReset,
  sendTeamInvite,
  sendMagicLink
} from '../utils/senders'
import { getEmailBrandConfig } from '../utils/template-renderer'
import { resolveEmailOverrides } from '../utils/resolve-email-settings'
import type { EmailTemplateType } from '../utils/resolve-email-settings'
import type { SendEmailResult } from '../../types'

/**
 * Resolve a team/organization brand name from the URL in the email payload.
 * Returns undefined on any failure so callers fall back to the config default.
 */
async function resolveBrandName(url: string): Promise<string | undefined> {
  try {
    const host = new URL(url).host
    // resolveTeamBrandFromHost is auto-imported from crouton-auth server utils
    return await resolveTeamBrandFromHost(host)
  }
  catch {
    return undefined
  }
}

/**
 * Resolve team email template overrides for a given email type and recipient.
 * Returns undefined on any failure so callers fall back to defaults.
 */
async function getOverrides(emailType: EmailTemplateType, context: {
  userEmail?: string
  organizationName?: string
}) {
  try {
    return await resolveEmailOverrides(emailType, context)
  }
  catch {
    return undefined
  }
}

/**
 * Nitro plugin that listens for crouton:auth:email hooks emitted by crouton-auth
 * and dispatches to the appropriate email sender.
 *
 * Apps without crouton-email simply never register this listener — hooks fire
 * with no handler, which is a silent no-op.
 */
export default defineNitroPlugin((nitroApp) => {
  console.log('[crouton-email] 🔌 auth-email-listener plugin registered')
  nitroApp.hooks.hook('crouton:auth:email', async (payload) => {
    console.log(`[crouton-email] 📨 Hook received: type=${payload.type}, to=${payload.to}`)
    let sendResult: SendEmailResult | undefined
    let caughtError: string | undefined
    try {
      switch (payload.type) {
        case 'verification': {
          const [brandName, overrides] = await Promise.all([
            resolveBrandName(payload.url),
            getOverrides('verification', { userEmail: payload.to })
          ])
          sendResult = await sendVerificationLink({
            to: payload.to,
            link: payload.url,
            name: payload.userName,
            ...(brandName && { brandName }),
            ...(overrides && { overrides })
          }, payload._event)
          break
        }

        case 'password-reset': {
          const [brandName, overrides] = await Promise.all([
            resolveBrandName(payload.url),
            getOverrides('password-reset', { userEmail: payload.to })
          ])
          sendResult = await sendPasswordReset({
            to: payload.to,
            link: payload.url,
            name: payload.userName,
            ...(brandName && { brandName }),
            ...(overrides && { overrides })
          }, payload._event)
          break
        }

        case 'invitation': {
          const brand = getEmailBrandConfig()
          // Use BETTER_AUTH_URL for action links (reflects the actual running instance),
          // falling back to brand.appUrl for backwards compatibility
          const runtimeConfig = payload._event ? useRuntimeConfig(payload._event) : useRuntimeConfig()
          const actionBaseUrl = process.env.BETTER_AUTH_URL
            || (runtimeConfig as any).auth?.baseUrl
            || brand.appUrl
          const acceptLink = `${actionBaseUrl}/auth/accept-invitation/${payload.invitationId}`
          console.log(`[crouton-email] 🔗 Invitation accept link: ${acceptLink}`)
          console.log(`[crouton-email] 🔍 BETTER_AUTH_URL=${process.env.BETTER_AUTH_URL}, auth.baseUrl=${(runtimeConfig as any).auth?.baseUrl}, brand.appUrl=${brand.appUrl}`)
          const overrides = await getOverrides('team-invite', {
            organizationName: payload.organizationName
          })
          console.log(`[crouton-email] 📋 Overrides resolved:`, overrides ? 'yes' : 'none')
          sendResult = await sendTeamInvite({
            to: payload.to,
            link: acceptLink,
            inviterName: payload.inviterName,
            teamName: payload.organizationName,
            role: payload.role,
            brandName: payload.organizationName,
            ...(overrides && { overrides })
          }, payload._event)
          console.log(`[crouton-email] 📬 sendTeamInvite result:`, JSON.stringify(sendResult))
          break
        }

        case 'magic-link': {
          const [brandName, overrides] = await Promise.all([
            resolveBrandName(payload.url),
            getOverrides('magic-link', { userEmail: payload.to })
          ])
          sendResult = await sendMagicLink({
            to: payload.to,
            link: payload.url,
            ...(brandName && { brandName }),
            ...(overrides && { overrides })
          }, payload._event)
          break
        }
      }
    }
    catch (err) {
      // Email failure must never break auth flow
      caughtError = err instanceof Error ? err.message : String(err)
      console.error(`[crouton-email] Failed to send ${payload.type} email to ${payload.to}:`, err)
    }
    finally {
      // Report the real outcome so crouton-auth's logger can flip the row it
      // logged as `pending` to `sent` / `failed` (issue #1542). Best-effort —
      // a hook failure must never break the auth flow.
      const ok = sendResult?.success === true
      try {
        await nitroApp.hooks.callHook('crouton:auth:email:result', {
          to: payload.to,
          type: payload.type,
          ok,
          error: ok ? undefined : (caughtError ?? sendResult?.error ?? 'send failed')
        })
      }
      catch (hookErr) {
        console.error('[crouton-email] Failed to emit email result hook:', hookErr)
      }
    }
  })
})
