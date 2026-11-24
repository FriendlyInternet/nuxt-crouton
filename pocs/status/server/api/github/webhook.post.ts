// GitHub repo webhook (#4309): marks "something changed on GitHub" so the next clock tick syncs the
// inbox. Signed with the Worker secret GITHUB_WEBHOOK_SECRET; rules in server/utils/webhook-core.ts.
// No session needed (GitHub sends no cookie); never calls GitHub or runs the sync itself.
// It also updates the one Pipeline-board row the event touches (#4350, server/utils/board-webhook.ts),
// for the owner team found by NUXT_STATUS_OWNER_EMAIL (read from the Worker env, as the clock does).
import { handleWebhook } from '../../utils/webhook-core'
import { writeBoardEvent } from '../../utils/board-webhook'

export default defineEventHandler(async (event) => {
  const rawBody = (await readRawBody(event, 'utf8')) ?? ''
  const env = (event.context as { cloudflare?: { env?: Record<string, unknown> } }).cloudflare?.env
  const secret = String(env?.GITHUB_WEBHOOK_SECRET || process.env.GITHUB_WEBHOOK_SECRET || '')
  const ownerEmail = String(env?.NUXT_STATUS_OWNER_EMAIL || process.env.NUXT_STATUS_OWNER_EMAIL || '')
  const repo = String(useRuntimeConfig(event).githubRepo || 'FriendlyInternet/nuxt-crouton')
  const { status } = await handleWebhook({
    headers: getRequestHeaders(event),
    rawBody,
    secret,
    repo,
    store: useStorage('kv'),
    board: ev => writeBoardEvent(ev, ownerEmail)
  })
  setResponseStatus(event, status)
  return null
})
